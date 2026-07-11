# Model visibility + control — Design

**Date:** 2026-07-11
**Feature:** 3 of 3 companion improvements (build order: 3 → 1 → 2; this is the foundational feature both others reuse).
**Status:** Approved by user 2026-07-11; pending implementation plan.

## Goal

Today `getMistralModel()` returns a single `MISTRAL_MODEL` env var (default `mistral-medium-latest`) used for every turn — no per-thread model, no model visibility in the UI, no auto-routing. This feature adds:

1. **Visibility** — the chat UI (and later the blog companion) shows which Mistral model is firing.
2. **Manual control** — switch per-thread via a dropdown, and by natural language ("use the biggest model for this", "switch to small").
3. **Auto-routing** — a difficulty classifier routes small/medium/large on `auto`, escalating to the largest model for hard tasks while keeping a cost-sensible default.

## Keystone decisions (chosen through brainstorming Q&A)

- **Data model:** `auto + pinned` model preference with **per-message model audit**. `chat_threads.model_preference` ∈ {auto, small, medium, large} (nullable → treated as `auto`); `chat_messages.model` records the actual model that generated each assistant turn.
- **Difficulty classifier:** **hybrid** — a pure heuristic scores first; only when the score lands in a borderline band does a `mistral-small` call break the tie. Non-borderline turns cost zero extra Mistral calls.
- **NL switching:** a new **`set_model` bot tool** (the LLM interprets "for this one" vs "from now on" and picks the scope). Determinism is traded for natural-language flexibility; the security guarantee is preserved.
- **UI:** a **header pill + dropdown** for the thread's model, plus a **per-message model tag** on each assistant message.

## Security guarantee (must hold throughout)

The architectural rule "the bot cannot edit site content" is unchanged. `set_model` writes only to `chat_threads` (`model_preference` / `one_turn_override`). It imports only the thread helpers from `lib/db/chat` — never `createPost`/`updatePost`/shelf/vault write functions. The `site:*` namespace guard is untouched. All tool args are schema-validated before SQL. `set_model` is not a site-write and is not counted against `MAX_MEMORY_WRITES`. The prompt's hard-scope note gains one line clarifying `set_model` only changes the answering model, nothing about the site.

## Architecture

### Data model (schema migration — additive, idempotent)

Three new columns, applied via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` to match the existing `schema-chat.sql` style:

```sql
ALTER TABLE public.chat_threads ADD COLUMN IF NOT EXISTS model_preference text;   -- 'auto'|'small'|'medium'|'large', null→'auto'
ALTER TABLE public.chat_threads ADD COLUMN IF NOT EXISTS one_turn_override  text;   -- 'small'|'medium'|'large', consumed once
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS model            text;   -- modelId that generated this assistant turn (null for user/tool rows)
```

No RLS policy changes (service-role only, as today). Applied to prod via `npx supabase db push --linked` (or `supabase db query --linked`).

### Model resolution — `lib/chat/models.ts` (new)

- `export const MODEL_TIERS = { small: "mistral-small-latest", medium: "mistral-medium-latest", large: "mistral-large-latest" }`
- `export const DEFAULT_TIER: ModelTier = "medium"`
- `export type ModelTier = "small" | "medium" | "large"`
- `export type ModelPreference = "auto" | ModelTier`
- `classifyDifficulty(message: string) → { score: number; band: "easy"|"medium"|"hard"; borderline: boolean }` — pure heuristic on length + signals (code blocks, multi-step verbs `explain`/`compare`/`architect`/`prove`/`debug`/`refactor`, long prose). Deterministic, zero Mistral calls.
- `classifyDifficultyHybrid(message: string) → Promise<{ band: Band; via: "heuristic"|"mistral-small" }>` — runs the heuristic; if `borderline`, makes one `mistralTurn` call to `mistral-small-latest` with a tiny "label difficulty: easy|medium|hard" prompt and uses its label; if that call fails, falls back to the heuristic band (never blocks the turn).
- `bandToTier(band: Band) → ModelTier` — easy→small, medium→medium, hard→large.
- `resolveModel({ preference, override, message }) → { tier: ModelTier; modelId: string; reason: string }` — priority **`override` > pinned `preference` > auto-classified > `DEFAULT_TIER`**.

### `/api/chat` route pipeline

The model is resolved **once per request** (one user message → one resolution used for every sub-turn of that request's agent loop). A `set_model` tool call writes the DB and takes effect on the **next** user turn — the tool result tells the bot "your next response uses X." This keeps the loop simple and the timing predictable.

1. Admin gate → load/create thread.
2. `override = thread.one_turn_override`; if set, **consume it** (set `one_turn_override = null` immediately) so it applies exactly once.
3. `preference = thread.model_preference ?? "auto"`.
4. If `preference === "auto"` and no override → `band = await classifyDifficultyHybrid(message)` → `tier = bandToTier(band)`. Else `tier = preference`.
5. `resolved = resolveModel({ preference, override, message })`; pass `model: resolved.modelId` into every `mistralStream` call in this request's loop.
6. Emit an SSE `{ type: "model", tier, modelId, reason }` event once per turn (after `thread`, before `content`).
7. Persist `resolved.modelId` on the assistant `appendMessage` row (`model` null for user/tool rows).

### The `set_model` bot tool (`lib/chat/tools.ts`)

Added to `CHAT_TOOLS` (surface is now six tools). Args, schema-validated in `executeToolCall`:

```ts
{ tier: "small" | "medium" | "large" | "auto", scope?: "persistent" | "turn" }  // scope default "persistent"
```

`ToolContext` is unchanged in shape (the `set_model` tool writes the DB directly, like `save_memory` does). Behavior:

- `scope: "persistent"` → calls `setThreadModelPreference(threadId, tier)` (writes `model_preference`).
- `scope: "turn"` → calls `setOneTurnOverride(threadId, tier)` (writes `one_turn_override`; consumed by the next turn's resolver).
- Returns content like `"Model set to large (persistent). Your next response uses mistral-large-latest."`
- **Not counted** against `MAX_MEMORY_WRITES` (it isn't a memory write).
- **Never throws** (returns an error string on invalid args), matching the existing tool contract.

The persistent-vs-turn choice is the LLM's to make from the phrasing ("from now on" → persistent; "for this one / just this turn" → turn).

### Mistral client (`lib/chat/mistral.ts`)

`CallOptions` gains `model?: string`; `callMistral` uses `opts.model ?? getMistralModel()`. `getMistralModel()` stays as the final fallback. Temperature 0.4 unchanged. This is the only touch to `mistral.ts`.

### Data-layer changes (`lib/db/chat.ts`)

- `ChatThread` gains `model_preference: ModelPreference | null`, `one_turn_override: ModelTier | null`.
- `ChatMessageRow` gains `model: string | null`.
- `createThread(title?, modelPreference?)`, `setThreadModelPreference(threadId, pref)`, `setOneTurnOverride(threadId, tier)`, `consumeOneTurnOverride(threadId)` (read-and-clear in one call, used by the route), `appendMessage({ ..., model? })`.
- `getThread`/`listThreads` select the new columns.

### Admin UI (`components/ChatUI.tsx`)

- A model pill in `.chat-head` showing the effective model — "Model: large" for a pinned thread, "Model: auto → medium" for an auto thread showing the resolved tier. Clicking opens a small dropdown: Auto / Small / Medium / Large. Selection calls a new `setThreadModelPreferenceAction` server action, then the pill updates optimistically.
- Each assistant `UIMessage` gains a `model` field; the message meta row shows a tiny `· medium` tag.
- The SSE `model` event sets the in-progress assistant message's model so the tag appears as it streams.
- Uses existing `chat-*` classes + `--terracotta`/`--sage`/`--walnut` tokens; mobile at 390 px keeps the pill inline (no horizontal overflow; composer still sticks).

### Server actions (`app/admin/chat/actions.ts`)

New `setThreadModelPreferenceAction(threadId, preference)` — admin-gated via `requireAdmin`, validates `preference ∈ {auto, small, medium, large}`, calls `setThreadModelPreference`.

### System prompt (`lib/chat/prompt.ts`)

- Tool list grows from five to six (adds `set_model`).
- Hard-scope note gains one line: `set_model` only changes which Mistral model answers — it cannot touch site content.

## Error handling

- Unknown/invalid resolved tier → fall back to `mistral-medium-latest`, continue the turn.
- `mistral-small` fallback classification call fails → use the heuristic band, continue (never blocks).
- `set_model` invalid tier → tool returns an error string (no throw).
- Stale `one_turn_override` from a crashed prior turn → consumed by the next turn (one free upgrade; harmless).

## Testing (Vitest, existing mocked-Mistral pattern)

- `tests/unit/chat-models.test.ts` (new) — `resolveModel` priority chain; `classifyDifficulty` bands + borderline flag; `classifyDifficultyHybrid` calls `mistralTurn` only when borderline, falls back on failure; `bandToTier` mapping.
- `chat-tools.test.ts` — `set_model` valid/invalid tier, both scopes, not memory-cap-counted, no `site:*` interaction.
- `chat-route.test.ts` — `model` SSE event emitted; `model` persisted on assistant rows; auto path classifies; pinned path skips classification; override consumed + cleared.
- `chat-memory.test.ts` — `setThreadModelPreference`, `setOneTurnOverride`/`consumeOneTurnOverride`, `createThread(modelPreference)`, `appendMessage(model)`.
- `chat-prompt.test.ts` — six tools listed; hard-scope note present + the new `set_model` scope line.

## Migration + carry-forward

- Add the three `ALTER`s to `supabase/schema-chat.sql` + `lib/db/schema.sql` §10; apply to prod.
- `npm run build` + `npm test` green; mobile 390 px check; admin-only; no site writes from the bot.
- The blog companion (feature 2) and the memory-inference pass (feature 1) reuse this model plumbing when they're built next.

## Open follow-ups (out of scope here)

- Per-thread model is not surfaced in `MemoriesManager` — only `/admin/chat`. Fine for now.
- No per-thread model analytics (which tier a thread tends to use) — deferred.
- The pre-existing "mistralTurn is imported in route.ts but unused" lint note is **not** resolved by this feature (the hybrid classifier lives in `lib/chat/models.ts`, which imports `mistralTurn` itself). Optionally remove the unused `route.ts` import during implementation for a clean lint.