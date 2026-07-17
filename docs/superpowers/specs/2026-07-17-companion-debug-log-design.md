# Companion per-thread debug log — design

> Status: approved 2026-07-17. Scope: the site-aware companion at `/admin/chat`
> (`chat_threads.purpose = 'chat'`) only. The blog companion
> (`purpose = 'blog-companion'`) is out of scope for this pass.

## Goal

Give the admin a "Save debug log" control in the `/admin/chat` UI that downloads
the **complete transcript of a thread plus the model's reasoning trace and
turn-level telemetry**, as both a structured JSON file and a human-readable
Markdown file.

## Why

Today the `/api/chat` route drops two kinds of useful debugging information:

1. **The reasoning trace.** `lib/chat/mistral.ts` already extracts the model's
   thinking via `extractReasoningContent` and exposes it through an `onReasoning`
   callback (lines 408–417). The route never wires that callback, so the trace is
   extracted then thrown away.
2. **Turn-level telemetry.** `AccumulatedMessage` already returns
   `response_model`, `reasoning_effort_sent`, `content_chunk_types`,
   `reasoning_chars`, `text_chars`, and `finish_reason` (advisor phase B9
   telemetry). The route reads only `content` and `tool_calls` off `acc` and
   discards the rest.

There is no way to inspect what the model actually produced internally on a given
turn, which makes debugging the companion's reasoning + web-search behavior
guesswork. This feature captures and exposes that, per thread, on demand.

## What the debug log contains

For each message row in the thread, in order:

- `id`, `role` (`user` | `assistant` | `tool`), `content`, `created_at`
- `model` (assistant turns)
- `tool_calls` (assistant turns: the calls the model issued; tool turns: the
  `{tool_call_id, name}` marker the route persists)
- `reasoning` (assistant turns only — the reasoning trace; `null` on
  non-reasoning-model turns and on all pre-feature turns)
- `telemetry` (assistant turns only — see shape below)

Plus thread metadata: `id`, `title`, `created_at`, `updated_at`,
`model_preference`, and an `exportedAt` timestamp.

**Out of scope (explicitly not captured):** the per-turn hidden inputs the model
saw — the assembled system prompt, recalled memories, site-awareness digest, and
web-evidence block. Those are rebuilt each turn and not persisted today; the
debug log is the *transcript + the model's own reasoning/telemetry*, not a full
input capture. (A future "full turn capture" pass can add those.)

## Architecture

`mistral.ts` is **unchanged** — it already extracts reasoning and returns
telemetry. The change is three layers on top of it:

1. **Persist** — add nullable `reasoning` + `telemetry` columns to
   `chat_messages`; widen `appendMessage` + `ChatMessageRow` to carry them.
2. **Capture** — in `/api/chat`'s agent loop, wire `onReasoning` to a per-turn
   accumulator and pass `acc`'s telemetry into the assistant `appendMessage`.
3. **Export** — a new admin-gated server action `getThreadDebugLogAction`
   assembles the structured payload; ChatUI generates JSON + Markdown
   client-side from that one payload and triggers a browser download.

Reasoning only appears on reasoning-model turns
(`mistral-medium-3-5` with `COMPANION_REASONING_EFFORT` set). On
`mistral-small`/`mistral-medium-latest`/`mistral-large-latest` turns there is no
thinking chunk, so `onReasoning` is never called and `reasoning` is persisted as
`null`. This is expected and correct, not a bug.

## Schema change (additive)

`lib/db/schema.sql` (§10 chat block) and the standalone
`supabase/schema-chat.sql`:

```sql
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS reasoning text;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS telemetry jsonb;
```

Both nullable, no default, no backfill. Old assistant turns have `null`
reasoning/telemetry — they were dropped before this feature, and we do not
invent them retroactively. RLS is already enabled on `chat_messages` with no
public policies (service-role only), unchanged.

## Data layer — `lib/db/chat.ts`

- New exported type:
  ```ts
  export interface DebugTelemetry {
    response_model?: string | null
    reasoning_effort_sent?: string | null
    content_chunk_types?: string[] | null
    reasoning_chars?: number | null
    text_chars?: number | null
    finish_reason?: string | null
  }
  ```
- Widen `ChatMessageRow` with `reasoning: string | null` and
  `telemetry: DebugTelemetry | null`.
- Widen `appendMessage` input with `reasoning?: string | null` and
  `telemetry?: unknown`; the insert sets `reasoning: input.reasoning ?? null` and
  `telemetry: input.telemetry ?? null`. User and tool callers pass nothing
  (both stay `null`).

## Route capture — `app/api/chat/route.ts`

Inside the `while (turns < MAX_TURNS)` agent loop, per turn:

- Declare `let turnReasoning = ""` before the `mistralStream` call.
- Add `onReasoning: (chunk: string) => { turnReasoning += chunk }` to the
  `mistralStream` options. The existing `onContent` is unchanged and never
  carries reasoning (`extractTextContent` strips thinking from `acc.content`).
- After `const acc = await mistralStream(...)`, build:
  ```ts
  const telemetry: DebugTelemetry = {
    response_model: acc.response_model ?? null,
    reasoning_effort_sent: acc.reasoning_effort_sent ?? null,
    content_chunk_types: acc.content_chunk_types ?? null,
    reasoning_chars: acc.reasoning_chars ?? null,
    text_chars: acc.text_chars ?? null,
    finish_reason: acc.finish_reason ?? null,
  }
  ```
- Pass `reasoning: turnReasoning || null` and `telemetry` into the assistant
  `appendMessage` (the one that persists `acc.content` + `acc.tool_calls`).

Unchanged: the user `appendMessage` (before the loop) and the tool-result
`appendMessage` (inside the tool-call loop) pass no reasoning/telemetry. The
catch-block partial-persistence path also passes no reasoning — `turnReasoning`
is loop-scoped and not visible in `catch`; partial turns are best-effort and
stay reasoning-`null`.

## Export action — `app/admin/chat/actions.ts`

```ts
export async function getThreadDebugLogAction(
  threadId: string
): Promise<
  | { success: true; log: CompanionDebugLog }
  | { success: false; error: string }
>
```

Behavior:
1. `await requireAdmin()`.
2. `const thread = await getChatThread(threadId)` — returns `null` for
   non-`chat`-purpose threads (companion threads) or unknown ids. If `null`,
   return `{ success: false, error: "Thread not found or not a chat thread" }`.
3. `const messages = await getMessages(threadId)`.
4. Assemble and return:
   ```ts
   {
     thread: {
       id: thread.id, title: thread.title,
       created_at: thread.created_at, updated_at: thread.updated_at,
       model_preference: thread.model_preference,
     },
     exportedAt: new Date().toISOString(),
     messages: messages.map((m) => ({
       id: m.id, role: m.role, content: m.content,
       created_at: m.created_at, model: m.model,
       tool_calls: m.tool_calls, reasoning: m.reasoning, telemetry: m.telemetry,
     })),
   }
   ```

`CompanionDebugLog` is an exported type in `lib/db/chat.ts` (alongside
`ChatMessageRow` and `DebugTelemetry`) so the client and tests share it.

## ChatUI — `components/ChatUI.tsx`

- Two small buttons in the `chat-head` (next to "Save memories now"): **⬇ JSON**
  and **⬇ MD**, both `disabled={streaming || !activeId}`.
- On click: call `getThreadDebugLogAction(activeId)`. On `success:false`, set
  `setError(error)`. On success, generate the file client-side from the one
  payload and trigger a download.
- JSON: `JSON.stringify(log, null, 2)` → `new Blob([json], { type: "application/json" })`
  → `URL.createObjectURL` → a temporary `<a download="chat-<threadId>-<YYYYMMDD-HHMM>.json">`
  → click → `URL.revokeObjectURL`.
- Markdown: a pure helper `debugLogToMarkdown(log: CompanionDebugLog): string`
  (in `lib/chat/debug-log.ts`, unit-tested) → same Blob/anchor flow, `.md`
  extension.
- A small `downloading` state disables the buttons while the fetch + blob work
  is in flight (brief).

ChatUI's existing conversation rendering maps only `id`, `role`, `content`,
`toolName`, and `model` off each message — it **ignores** the new `reasoning` and
`telemetry` fields, so reasoning never appears in the live conversation. Only the
downloaded debug log surfaces them.

### Markdown shape

```
# Debug log — <title>

Thread: <id>
Created: <created_at>
Updated: <updated_at>
Model preference: <model_preference ?? "auto">
Exported: <exportedAt>

---

## [user] · <created_at>

<content>

---

## [assistant] · <created_at> · model: <model>

<content>

**Telemetry:** response_model=<…>, reasoning_effort=<…>, reasoning_chars=<…>, text_chars=<…>, finish_reason=<…>, chunk_types=[…]

**Tool calls:**
- <name>(<arguments>)

### Reasoning

<reasoning>

---

## [tool] · <created_at> · tool: <name>

<content>

---
```

Rules: omit the `### Reasoning` block when `reasoning` is null/empty; omit the
`Telemetry` line when all fields are null; omit `Tool calls` when none. Pure
function, no DOM, no env.

## Safety & security

1. **Reasoning never reaches the author-facing SSE.** `onReasoning` feeds only
   the loop-local `turnReasoning` accumulator, which flows exclusively into
   `appendMessage` persistence. `onContent` is unchanged and
   `extractTextContent` already strips thinking from `acc.content`. The SSE
   `send({ type: "content", delta })` events carry only text deltas. A new
   static-deps test asserts no SSE event from the route carries a `reasoning`
   field and that `onReasoning` is wired only to a local accumulator.
2. **Admin-only.** `getThreadDebugLogAction` calls `requireAdmin()`. `/api/chat`
   is already admin-gated (`getCurrentUser` + `isAdmin` → 401). No new public
   route is introduced.
3. **Import boundary unchanged.** No site-write functions are imported anywhere
   in this feature. Reasoning/telemetry never flow into `saveMemory` or
   `inferMemoriesFromThread` — the existing static guard is extended to assert
   this.
4. **No `dangerouslySetInnerHTML`.** The Markdown/JSON are downloaded as files,
   never rendered as raw HTML in the app.

## Testing (TDD)

- `lib/db/chat.ts` — `appendMessage` persists `reasoning` + `telemetry` columns
  (mock the service-client insert, assert the insert payload).
- `app/api/chat/route.ts` — a mocked `mistralStream` that fires `onReasoning`
  with chunks → assert the assistant `appendMessage` is called with the
  accumulated reasoning + the telemetry built from `acc`; drain the SSE stream
  and assert **no event carries a `reasoning` field**.
- `getThreadDebugLogAction` — returns the structured payload for a chat thread;
  returns `{success:false}` for a companion-purpose thread and for an unknown id;
  admin-gated (calls `requireAdmin`).
- `debugLogToMarkdown` — renders thread header, per-message sections, telemetry
  line, tool-call sub-list, and a `### Reasoning` block when reasoning present;
  omits the reasoning block and telemetry line when absent.
- `ChatUI.test.tsx` — static-grep: has the JSON + MD buttons, calls
  `getThreadDebugLogAction`, downloads via `Blob` + `URL.createObjectURL`, no
  `dangerouslySetInnerHTML`.
- `chat-web-static-deps.test.ts` — extended: the route wires `onReasoning` only
  to a local accumulator; no SSE `send` includes `reasoning`; reasoning/telemetry
  never reach `saveMemory`/`inferMemoriesFromThread`.
- `npx tsc --noEmit`, `npx vitest run`, `npm run build` all green.

## Deploy / merge

Per the standing rule: no deploy or merge to `master` without the user's
explicit go-ahead. The schema `ALTER TABLE … ADD COLUMN IF NOT EXISTS` is applied
to prod Supabase separately (additive, safe). Branch first; deploy from the repo
root with `vercel --prod --yes --scope thegrandpingu-9836s-projects` only on
go-ahead.

## Non-goals / future

- Blog-companion debug logs (separate loop, separate UI) — later pass.
- Capturing the per-turn hidden inputs (system prompt, memories, site context,
  web evidence) — a future "full turn capture" pass.
- A live in-app reasoning viewer panel (the "Thinking…" panel is a separate
  already-discussed feature) — this spec is the downloaded file only.