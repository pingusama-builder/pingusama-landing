# Auto Memory Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-pass inference pass that reads a chat thread's transcript, extracts durable memories, gates them through a strict hygiene filter, and auto-saves them to the memory bank — triggered manually from the chat UI and the MemoriesManager, and automatically for idle threads — without ever giving the inference path site-write reach.

**Architecture:** A new `lib/chat/infer.ts` makes two `mistralTurn` calls (both `mistral-large-latest`, no tools) — pass 1 extracts candidate memories generously, pass 2 gates them (drop transient/derivable/duplicate, consolidate, refine names). Kept entries save via the existing `saveMemory`, so the `site:*` namespace guard, schema validation, and upsert-by-name dedupe all still hold. Two additive columns (`chat_threads.last_inferred_at`, `chat_memories.source`) track ripeness and provenance. Three triggers share one function: a "Save memories now" button in the chat UI, an "Infer from a thread…" picker in MemoriesManager, and an on-mount piggyback in MemoriesManager that infers ≤2 threads idle ≥15 min via a `requireAdmin` server action (no cron, no new dependency).

**Tech Stack:** Next.js 16 server actions, Supabase service-role client, Mistral La Plateforme chat completions (thin client in `lib/chat/mistral.ts`), Vitest unit tests with a hand-rolled Supabase fake, Fraunces/Nunito CSS tokens.

## Global Constraints

- **Security guarantee:** the inference path (`lib/chat/infer.ts`, `app/admin/chat/actions.ts` inference actions) imports NO site-write function (`createPost`/`updatePost`/`deletePost`/shelf/vault/storage writes). Only `saveMemory` (guarded), read-only `getMessages`/`listAllMemories`/`recallMemories`, read-only `buildSiteContext`, and `mistralTurn` may be imported. `assertPersonalName` must reject any `site:*` name the model emits. Both Mistral passes are pure text calls with NO tools.
- **Admin-only:** every trigger goes through `requireAdmin` (server action) — never callable by anon.
- **Schema:** additive + idempotent only — `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, matching the existing `schema-chat.sql` style. No RLS changes.
- **CSS:** only Fraunces/Nunito tokens from `app/globals.css`; verify at 390 px (button wraps, picker collapses, cards wrap, no horizontal overflow).
- **Verify:** `npm test` (target 174 → ~186+), `npm run build` green, `tsc --noEmit` clean.
- **Tokens:** `MISTRAL_API_KEY` already in Vercel Production+Preview+Development env; `MISTRAL_INFER_MODEL` is optional (defaults to `mistral-large-latest`).
- **Manual-only checks** (need the user's admin login, the agent doesn't): live inference via the UI, 390 px eyeball, prod schema apply if the Supabase token is expired.

**Implementation note (deviation from spec, for the better):** the spec said "Vercel `waitUntil` from `@vercel/functions`" for the piggyback. `@vercel/functions` is not installed and `after()`/`waitUntil` would only surface results on the *next* page load. Instead the MemoriesManager client calls a `requireAdmin` server action on mount — dep-free, page renders instantly, and the inferred summary surfaces on the *same* load. The `last_inferred_at` stamp plus the "unprocessed" selector prevent repeats.

---

## File Structure

- **`my-app/lib/chat/infer.ts`** (new) — `inferMemoriesFromThread(threadId)`: transcript shaping, two Mistral passes, parse + validate + save, stamp `last_inferred_at`. The only inference entry point.
- **`my-app/lib/db/chat.ts`** (modify) — add `source` to `SaveMemoryInput`/`MemoryRow`, write it in `saveMemory`; add `touchInferredAt`, `listIdleUnprocessedThreads`.
- **`my-app/app/admin/chat/actions.ts`** (modify) — add `inferFromThreadAction`, `inferIdleThreadsAction` (both `requireAdmin`-gated).
- **`my-app/components/ChatUI.tsx`** (modify) — "Save memories now" button + status line.
- **`my-app/components/MemoriesManager.tsx`** (modify) — "Infer from a thread…" picker, "Recently inferred" filter, inferred badge, on-mount piggyback.
- **`my-app/app/globals.css`** (modify) — styles for the new button/picker/badge/banner (Fraunces/Nunito only, 390 px breakpoints).
- **`my-app/supabase/schema-chat.sql`** + **`my-app/lib/db/schema.sql`** (modify) — two `ADD COLUMN IF NOT EXISTS` statements.
- **`my-app/tests/unit/chat-memory.test.ts`** (modify) — `source`, `touchInferredAt`, `listIdleUnprocessedThreads` tests + FakeClient `.lt`.
- **`my-app/tests/unit/chat-infer.test.ts`** (new) — two-pass logic, site:* rejection, malformed JSON, dedupe, stamping, summary shape.
- **`my-app/tests/unit/chat-actions.test.ts`** (modify) — `inferFromThreadAction`/`inferIdleThreadsAction` admin gate + happy path.

---

### Task 1: Branch + data layer (`source`, `touchInferredAt`, `listIdleUnprocessedThreads`)

**Files:**
- Create: `my-app/lib/chat/infer.ts` is NOT in this task (Task 2). This task is data-layer only.
- Modify: `my-app/lib/db/chat.ts`
- Modify: `my-app/tests/unit/chat-memory.test.ts`
- Modify: `my-app/supabase/schema-chat.sql`
- Modify: `my-app/lib/db/schema.sql` (§10 — the chat schema block)
- Test: `my-app/tests/unit/chat-memory.test.ts`

**Interfaces:**
- Produces: `SaveMemoryInput.source?: "chat" | "inference"` (default `"chat"`); `MemoryRow.source: string`; `touchInferredAt(threadId: string): Promise<void>`; `listIdleUnprocessedThreads(opts: { idleMinutes: number; limit: number }): Promise<Pick<ChatThread, "id" | "title" | "updated_at" | "last_inferred_at">[]>`.
- Consumes: existing `client()`, `handle()`, `ChatThread` type.

- [ ] **Step 1: Create the feature branch**

Run:
```bash
cd "D:\claude projects\Pingusama's Repositories\pingusama-site-mockup-wheel"
git checkout -b feat/auto-memory-inference
```
Expected: `Switched to a new branch 'feat/auto-memory-inference'`

- [ ] **Step 2: Add the two columns to `schema-chat.sql`**

In `my-app/supabase/schema-chat.sql`, append after the existing model-control `ALTER TABLE` block (the lines ending with `ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS model text;`):

```sql

-- Auto memory inference (companion feature 1/3) — additive.
-- last_inferred_at: when inference last processed this thread (null = never).
ALTER TABLE public.chat_threads ADD COLUMN IF NOT EXISTS last_inferred_at timestamptz NULL;
-- source: provenance — 'chat' (in-turn save_memory tool) vs 'inference' (inference pass).
ALTER TABLE public.chat_memories ADD COLUMN IF NOT EXISTS source text NULL DEFAULT 'chat';
```

- [ ] **Step 3: Add the same two columns to `lib/db/schema.sql` §10**

In `my-app/lib/db/schema.sql`, find the section 10 chat block that contains the model-control `ALTER TABLE … ADD COLUMN IF NOT EXISTS model text;` line and append the identical two statements:

```sql

-- Auto memory inference (companion feature 1/3) — additive.
ALTER TABLE public.chat_threads ADD COLUMN IF NOT EXISTS last_inferred_at timestamptz NULL;
ALTER TABLE public.chat_memories ADD COLUMN IF NOT EXISTS source text NULL DEFAULT 'chat';
```

- [ ] **Step 4: Write the failing tests in `chat-memory.test.ts`**

In `my-app/tests/unit/chat-memory.test.ts`:

First, extend the `Query` class inside the file (it currently has `eq`/`neq`/`in`). Add an `lt` method so `listIdleUnprocessedThreads` can be exercised:

```typescript
  lt(c: string, v: unknown) {
    ;(this.filters[c] ??= []).push(v)
    return this
  }
```

Then extend `baseRow` to include `source`:

```typescript
const baseRow = (over: Partial<MemoryRow> = {}): MemoryRow => ({
  id: "row-1",
  type: "user",
  name: "prefers-terracotta",
  description: "likes warm terracotta accents",
  content: "Prefers terracotta accents across the site.",
  links: [],
  source_thread_id: null,
  source: "chat",
  fingerprint: null,
  last_used_at: "2026-07-11T00:00:00Z",
  last_synced_at: null,
  created_at: "2026-07-11T00:00:00Z",
  updated_at: "2026-07-11T00:00:00Z",
  active: true,
  ...over,
})
```

Add `touchInferredAt`, `listIdleUnprocessedThreads`, and `saveMemory` `source` to the imports at the top of the file (the existing import block from `@/lib/db/chat`):

```typescript
import {
  isValidName,
  assertMemoryInput,
  assertPersonalName,
  saveMemory,
  updateMemory,
  deleteMemory,
  recallMemories,
  upsertSiteAwareness,
  touchInferredAt,
  listIdleUnprocessedThreads,
  MAX_CONTENT,
  MAX_DESCRIPTION,
  type MemoryRow,
} from "@/lib/db/chat"
```

Add `last_inferred_at` to `baseThread`:

```typescript
const baseThread = (over: Partial<ChatThread> = {}): ChatThread => ({
  id: "t1",
  title: "New conversation",
  created_at: "2026-07-11T00:00:00Z",
  updated_at: "2026-07-11T00:00:00Z",
  model_preference: null,
  one_turn_override: null,
  last_inferred_at: null,
  ...over,
})
```

Append these new test blocks at the end of the file:

```typescript
describe("saveMemory (source provenance)", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })
  it("defaults source to 'chat' when omitted", async () => {
    const fake = holder.current!
    fake.push(null)
    fake.push(baseRow({ name: "prefers-terracotta" }))
    await saveMemory({
      type: "user",
      name: "prefers-terracotta",
      description: "d",
      content: "c",
    })
    expect(fake.calls[1].payload).toMatchObject({ source: "chat" })
  })
  it("writes source 'inference' when provided", async () => {
    const fake = holder.current!
    fake.push(null)
    fake.push(baseRow({ name: "x-name", source: "inference" }))
    await saveMemory({
      type: "user",
      name: "x-name",
      description: "d",
      content: "c",
      source: "inference",
    })
    expect(fake.calls[1].payload).toMatchObject({ source: "inference" })
  })
})

describe("touchInferredAt", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })
  it("stamps last_inferred_at on the thread", async () => {
    const fake = holder.current!
    fake.push(null, null) // update(...).then → { error: null }
    await touchInferredAt("t1")
    expect(fake.calls[0].table).toBe("chat_threads")
    expect(fake.calls[0].payload).toHaveProperty("last_inferred_at")
    expect(fake.calls[0].filters.id).toContain("t1")
  })
})

describe("listIdleUnprocessedThreads", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })
  it("returns only threads with unprocessed content (last_inferred_at null or older than updated_at)", async () => {
    const fake = holder.current!
    const threads = [
      baseThread({ id: "a", updated_at: "2026-07-11T10:00:00Z", last_inferred_at: null }),
      baseThread({ id: "b", updated_at: "2026-07-11T10:00:00Z", last_inferred_at: "2026-07-11T09:00:00Z" }),
      baseThread({ id: "c", updated_at: "2026-07-11T10:00:00Z", last_inferred_at: "2026-07-11T11:00:00Z" }), // already processed past updated_at
    ]
    fake.push(threads) // list query
    const out = await listIdleUnprocessedThreads({ idleMinutes: 15, limit: 5 })
    expect(out.map((t) => t.id)).toEqual(["a", "b"])
  })
  it("returns an empty list when nothing matches", async () => {
    holder.current!.push([])
    const out = await listIdleUnprocessedThreads({ idleMinutes: 15, limit: 5 })
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run:
```bash
cd "D:\claude projects\Pingusama's Repositories\pingusama-site-mockup-wheel\my-app"
npm test -- tests/unit/chat-memory.test.ts
```
Expected: FAIL — `touchInferredAt`/`listIdleUnprocessedThreads` not exported, `source` not a property, `lt` not a function on Query (may surface as a runtime error in `listIdleUnprocessedThreads` test).

- [ ] **Step 6: Implement the data-layer changes in `lib/db/chat.ts`**

In `my-app/lib/db/chat.ts`:

Add `source: string` to the `MemoryRow` interface (after `source_thread_id`):

```typescript
export interface MemoryRow {
  id: string
  type: MemoryType
  name: string
  description: string
  content: string
  links: string[]
  source_thread_id: string | null
  source: string
  fingerprint: string | null
  last_used_at: string
  last_synced_at: string | null
  created_at: string
  updated_at: string
  active: boolean
}
```

Add `last_inferred_at` to `ChatThread` (after `one_turn_override`):

```typescript
export interface ChatThread {
  id: string
  title: string
  created_at: string
  updated_at: string
  model_preference: ModelPreference | null
  one_turn_override: ModelTier | null
  last_inferred_at: string | null
}
```

Add `source?` to `SaveMemoryInput`:

```typescript
export interface SaveMemoryInput {
  type: MemoryType
  name: string
  description: string
  content: string
  links?: string[]
  sourceThreadId?: string
  source?: "chat" | "inference"
}
```

In `saveMemory`, add `source` to the `row` object it builds. Find the `const row = { ... }` block inside `saveMemory` and add the `source` field:

```typescript
  const row = {
    type: input.type,
    name: input.name,
    description: input.description,
    content: input.content,
    links: input.links ?? [],
    source_thread_id: input.sourceThreadId ?? null,
    source: input.source ?? "chat",
    last_used_at: now,
    updated_at: now,
    active: true,
  }
```

Append the two new helpers at the end of the file (after `updateMemoryContent`):

```typescript
export async function touchInferredAt(threadId: string): Promise<void> {
  const c = client()
  const { error } = await c
    .from("chat_threads")
    .update({ last_inferred_at: new Date().toISOString() })
    .eq("id", threadId)
  handle(error)
}

export async function listIdleUnprocessedThreads(opts: {
  idleMinutes: number
  limit: number
}): Promise<Pick<ChatThread, "id" | "title" | "updated_at" | "last_inferred_at">[]> {
  const cutoff = new Date(Date.now() - opts.idleMinutes * 60_000).toISOString()
  const c = client()
  const { data, error } = await c
    .from("chat_threads")
    .select("id,title,updated_at,last_inferred_at")
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: false })
    .limit(opts.limit)
  handle(error)
  const rows = (data ?? []) as Array<
    Pick<ChatThread, "id" | "title" | "updated_at" | "last_inferred_at">
  >
  return rows.filter((r) => {
    if (!r.last_inferred_at) return true
    return new Date(r.last_inferred_at) < new Date(r.updated_at)
  })
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run:
```bash
npm test -- tests/unit/chat-memory.test.ts
```
Expected: PASS — all existing + new `source`/`touchInferredAt`/`listIdleUnprocessedThreads` tests green.

- [ ] **Step 8: Run the full suite + typecheck**

Run:
```bash
npm test
npx tsc --noEmit
```
Expected: 174 still pass (no regressions); tsc clean (the new `source` field on `MemoryRow` is supplied everywhere via `baseRow` in tests; other call sites construct rows server-side via `saveMemory` which now sets it).

- [ ] **Step 9: Commit**

```bash
cd "D:\claude projects\Pingusama's Repositories\pingusama-site-mockup-wheel"
git add my-app/lib/db/chat.ts my-app/supabase/schema-chat.sql my-app/lib/db/schema.sql my-app/tests/unit/chat-memory.test.ts
git commit -m "feat(chat): source provenance + last_inferred_at data layer for memory inference

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Inference module — `lib/chat/infer.ts`

**Files:**
- Create: `my-app/lib/chat/infer.ts`
- Test: `my-app/tests/unit/chat-infer.test.ts`

**Interfaces:**
- Consumes: `mistralTurn(opts: { model, maxTokens, messages })` from `@/lib/chat/mistral`; `getMessages`, `listAllMemories`, `recallMemories`, `saveMemory`, `touchInferredAt`, `assertMemoryInput`, `assertPersonalName`, `ChatMessageRow`, `MemoryType` from `@/lib/db/chat`; `MODEL_TIERS` from `@/lib/chat/models`.
- Produces: `inferMemoriesFromThread(threadId: string): Promise<InferenceSummary>` where `InferenceSummary = { threadId, threadTitle, saved: {name, type}[], dropped, skipped, inferredAt }`.

- [ ] **Step 1: Write the failing tests in `chat-infer.test.ts`**

Create `my-app/tests/unit/chat-infer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the Mistral client — capture the two passes' return values.
const mistralMock = vi.hoisted(() => ({ turn: vi.fn() }))
vi.mock("@/lib/chat/mistral", () => ({ mistralTurn: mistralMock.turn }))

// Mock the data layer — track saves + stamps.
const dbMock = vi.hoisted(() => ({
  getMessages: vi.fn(),
  listAllMemories: vi.fn(),
  recallMemories: vi.fn(),
  saveMemory: vi.fn(),
  touchInferredAt: vi.fn(),
  assertMemoryInput: vi.fn(),
  assertPersonalName: vi.fn(),
}))
vi.mock("@/lib/db/chat", () => ({
  getMessages: dbMock.getMessages,
  listAllMemories: dbMock.listAllMemories,
  recallMemories: dbMock.recallMemories,
  saveMemory: dbMock.saveMemory,
  touchInferredAt: dbMock.touchInferredAt,
  assertMemoryInput: dbMock.assertMemoryInput,
  assertPersonalName: dbMock.assertPersonalName,
}))
vi.mock("@/lib/chat/models", () => ({ MODEL_TIERS: { small: "s", medium: "m", large: "mistral-large-latest" } }))

import { inferMemoriesFromThread } from "@/lib/chat/infer"

const msg = (role: "user" | "assistant" | "tool", content: string) =>
  ({ id: `${role}-${content.slice(0,4)}`, thread_id: "t1", role, content, tool_calls: null, model: null, created_at: "x" })

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.listAllMemories.mockResolvedValue([])
  dbMock.recallMemories.mockResolvedValue([])
  dbMock.assertMemoryInput.mockImplementation(() => {})
  dbMock.assertPersonalName.mockImplementation(() => {})
})

describe("inferMemoriesFromThread", () => {
  it("saves only verdict=keep entries from pass 2", async () => {
    dbMock.getMessages.mockResolvedValue([
      msg("user", "I really like terracotta accents everywhere"),
      msg("assistant", "Got it, I'll remember that."),
    ])
    // pass 1: two raw candidates
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "prefers-terracotta", description: "d", content: "c" },
      { type: "idea", name: "transient-thought", description: "d", content: "c" },
    ]), tool_calls: [], finish_reason: "stop" })
    // pass 2: keep first, drop second
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "prefers-terracotta", description: "d", content: "c", verdict: "keep", reason: "durable" },
      { type: "idea", name: "transient-thought", description: "d", content: "c", verdict: "drop", reason: "transient" },
    ]), tool_calls: [], finish_reason: "stop" })
    dbMock.saveMemory.mockImplementation(async (input: any) => ({ name: input.name, type: input.type }))

    const summary = await inferMemoriesFromThread("t1")

    expect(summary.saved).toEqual([{ name: "prefers-terracotta", type: "user" }])
    expect(summary.dropped).toBe(1)
    expect(summary.skipped).toBe(0)
    expect(dbMock.saveMemory).toHaveBeenCalledTimes(1)
    expect(dbMock.saveMemory.mock.calls[0][0]).toMatchObject({ source: "inference", sourceThreadId: "t1" })
    expect(dbMock.touchInferredAt).toHaveBeenCalledWith("t1")
  })

  it("skips (does not save) entries that fail assertPersonalName (site:* guard)", async () => {
    dbMock.getMessages.mockResolvedValue([
      msg("user", "hello there"),
      msg("assistant", "hi"),
    ])
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "site:blog", description: "d", content: "c" },
    ]), tool_calls: [], finish_reason: "stop" })
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "site:blog", description: "d", content: "c", verdict: "keep", reason: "x" },
    ]), tool_calls: [], finish_reason: "stop" })
    // assertPersonalName throws for site:*
    dbMock.assertPersonalName.mockImplementation(() => { throw new Error("managed by refresh_awareness") })
    dbMock.saveMemory.mockResolvedValue({ name: "should-not-happen", type: "user" })

    const summary = await inferMemoriesFromThread("t1")
    expect(summary.saved).toEqual([])
    expect(summary.skipped).toBe(1)
    expect(dbMock.saveMemory).not.toHaveBeenCalled()
  })

  it("returns an empty summary without calling Mistral when the transcript is too short", async () => {
    dbMock.getMessages.mockResolvedValue([msg("user", "hi")]) // only 1 non-tool message
    const summary = await inferMemoriesFromThread("t1")
    expect(summary.saved).toEqual([])
    expect(summary.dropped).toBe(0)
    expect(mistralMock.turn).not.toHaveBeenCalled()
    expect(dbMock.touchInferredAt).toHaveBeenCalledWith("t1")
  })

  it("returns an empty summary when pass 1 yields no candidates", async () => {
    dbMock.getMessages.mockResolvedValue([
      msg("user", "what is 2+2"),
      msg("assistant", "4"),
    ])
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: "[]", tool_calls: [], finish_reason: "stop" })
    const summary = await inferMemoriesFromThread("t1")
    expect(summary.saved).toEqual([])
    expect(mistralMock.turn).toHaveBeenCalledTimes(1) // pass 2 never runs
  })

  it("handles malformed pass-2 JSON (no throw, all skipped)", async () => {
    dbMock.getMessages.mockResolvedValue([
      msg("user", "I like terracotta accents"),
      msg("assistant", "noted"),
    ])
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "prefers-terracotta", description: "d", content: "c" },
    ]), tool_calls: [], finish_reason: "stop" })
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: "sorry, I can't do JSON", tool_calls: [], finish_reason: "stop" })
    const summary = await inferMemoriesFromThread("t1")
    expect(summary.saved).toEqual([])
    expect(summary.skipped).toBe(0) // nothing to skip — parsed array was empty
    expect(summary.dropped).toBe(0)
    expect(dbMock.touchInferredAt).toHaveBeenCalledWith("t1")
  })

  it("dedupes by name via saveMemory upsert (two keeps with the same name save once each but the bank dedupes)", async () => {
    dbMock.getMessages.mockResolvedValue([
      msg("user", "I like terracotta accents"),
      msg("assistant", "noted"),
    ])
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "prefers-terracotta", description: "d", content: "c" },
    ]), tool_calls: [], finish_reason: "stop" })
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "prefers-terracotta", description: "d", content: "c", verdict: "keep", reason: "x" },
      { type: "user", name: "prefers-terracotta", description: "d2", content: "c2", verdict: "keep", reason: "refine" },
    ]), tool_calls: [], finish_reason: "stop" })
    dbMock.saveMemory.mockImplementation(async (input: any) => ({ name: input.name, type: input.type }))
    const summary = await inferMemoriesFromThread("t1")
    // Both keeps are attempted (the bank's upsert-by-name dedupes); both reported.
    expect(summary.saved).toHaveLength(2)
    expect(dbMock.saveMemory).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm test -- tests/unit/chat-infer.test.ts
```
Expected: FAIL — `@/lib/chat/infer` does not exist (cannot resolve module).

- [ ] **Step 3: Implement `lib/chat/infer.ts`**

Create `my-app/lib/chat/infer.ts`:

```typescript
// Two-pass memory inference. Reads a thread's transcript, extracts candidate
// durable memories (pass 1, generous), gates them through a strict hygiene
// filter (pass 2, drops transient/derivable/duplicate + consolidates), and
// saves the keeps via the existing saveMemory — so the site:* namespace guard,
// schema validation, and upsert-by-name dedupe all still hold.
//
// SECURITY: this module imports only saveMemory (guarded), read-only
// getMessages/listAllMemories/recallMemories, read-only buildSiteContext (not
// used here but available), and mistralTurn. NO site-write function is ever
// imported. Both Mistral passes are pure text calls with NO tools, so the
// inference LLM has less reach than the chat LLM. A prompt-injected transcript
// can at worst produce a memory whose text content is odd — it still cannot
// name site:* (assertPersonalName rejects) and has zero site-write capability.

import { mistralTurn } from "@/lib/chat/mistral"
import { MODEL_TIERS } from "@/lib/chat/models"
import {
  getMessages,
  listAllMemories,
  recallMemories,
  saveMemory,
  touchInferredAt,
  assertMemoryInput,
  assertPersonalName,
  type ChatMessageRow,
  type MemoryType,
} from "@/lib/db/chat"

const INFERENCE_MODEL = process.env.MISTRAL_INFER_MODEL || MODEL_TIERS.large
const MAX_TRANSCRIPT_CHARS = 100000

export interface InferenceSummary {
  threadId: string
  threadTitle: string
  saved: { name: string; type: MemoryType }[]
  dropped: number
  skipped: number
  inferredAt: string
}

interface RawCandidate {
  type?: string
  name?: string
  description?: string
  content?: string
  links?: unknown
}
interface GatedCandidate extends RawCandidate {
  verdict?: "keep" | "drop"
  reason?: string
}

const PASS1_SYSTEM = `You read a past chat conversation and extract every candidate worth keeping as a DURABLE memory for the site companion. Memory types: user (about the person), feedback (how to respond / corrections), project (what they're building), reference (pointer to a resource), idea (content suggestion). Never use type "site" — site awareness is managed elsewhere. Be generous: extract anything that MIGHT be a durable fact; a later stage filters. Reuse existing memory names to refine rather than duplicate. Return ONLY a JSON array of {type,name,description,content,links?}. If nothing durable, return [].`

const PASS2_SYSTEM = `You are a strict memory hygienist. For each candidate decide: durable+verified vs a transient chat moment; derivable from the site awareness/code (trivia) vs not; a duplicate/near-duplicate of an existing memory vs something to refine. Consolidate near-duplicates (you may return fewer entries than given). For each kept entry refine the name (lowercase kebab) and content. Return ONLY a JSON array of {type,name,description,content,links?,verdict,reason} where verdict is "keep" or "drop". Keep only what is clearly durable and not already known.`

function parseJsonArray(raw: string): unknown[] {
  if (!raw) return []
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end === -1 || end < start) return []
  text = text.slice(start, end + 1)
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function shapeTranscript(rows: ChatMessageRow[]): { transcript: string; enough: boolean } {
  const lines: string[] = []
  let nonTool = 0
  for (const r of rows) {
    if (r.role === "user") {
      nonTool++
      lines.push(`user: ${r.content ?? ""}`)
    } else if (r.role === "assistant") {
      nonTool++
      lines.push(`companion: ${r.content ?? ""}`)
    } else if (r.role === "tool") {
      const name = (r.tool_calls as { name?: string } | null)?.name ?? "tool"
      lines.push(`[tool: ${name}]`)
    }
  }
  let transcript = lines.join("\n")
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS)
  }
  return { transcript, enough: nonTool >= 2 }
}

function titleFrom(rows: ChatMessageRow[]): string {
  const u = rows.find((r) => r.role === "user" && r.content && r.content.trim())
  if (!u) return "conversation"
  const s = (u.content ?? "").trim().replace(/\s+/g, " ")
  return s.length > 60 ? s.slice(0, 60) + "…" : s
}

export async function inferMemoriesFromThread(threadId: string): Promise<InferenceSummary> {
  const inferredAt = new Date().toISOString()
  const rows = await getMessages(threadId)
  const threadTitle = titleFrom(rows)
  const empty: InferenceSummary = {
    threadId,
    threadTitle,
    saved: [],
    dropped: 0,
    skipped: 0,
    inferredAt,
  }

  const { transcript, enough } = shapeTranscript(rows)
  if (!enough) {
    await touchInferredAt(threadId)
    return empty
  }

  const existing = (await listAllMemories({ activeOnly: true })).filter((m) => m.type !== "site")
  const existingNames = existing.map((m) => m.name)

  // Pass 1 — extract (generous).
  const pass1 = await mistralTurn({
    model: INFERENCE_MODEL,
    maxTokens: 2000,
    messages: [
      { role: "system", content: PASS1_SYSTEM },
      {
        role: "user",
        content: `Existing memory names to reuse: ${existingNames.join(", ") || "(none)"}\n\nConversation:\n${transcript}`,
      },
    ],
  })
  const raws = parseJsonArray(pass1.content ?? "").map((x) => x as RawCandidate)
  if (raws.length === 0) {
    await touchInferredAt(threadId)
    return empty
  }

  // Compact site awareness for pass 2 (so it can drop derivable trivia).
  const siteMemories = (await recallMemories({ includeSite: true, limit: 20 })).filter(
    (m) => m.type === "site"
  )
  const siteSummary =
    siteMemories.map((m) => `- ${m.name}: ${m.description}`).join("\n") || "(none)"

  // Pass 2 — hygiene gate (strict).
  const pass2 = await mistralTurn({
    model: INFERENCE_MODEL,
    maxTokens: 2000,
    messages: [
      { role: "system", content: PASS2_SYSTEM },
      {
        role: "user",
        content: `Existing memory names: ${existingNames.join(", ") || "(none)"}\nSite awareness (already known — drop derivable trivia):\n${siteSummary}\n\nCandidates:\n${JSON.stringify(raws, null, 2)}`,
      },
    ],
  })
  const gated = parseJsonArray(pass2.content ?? "").map((x) => x as GatedCandidate)

  const saved: { name: string; type: MemoryType }[] = []
  let dropped = 0
  let skipped = 0

  for (const g of gated) {
    if (g.verdict !== "keep") {
      dropped++
      continue
    }
    const input = {
      type: typeof g.type === "string" ? g.type : "",
      name: typeof g.name === "string" ? g.name : "",
      description: typeof g.description === "string" ? g.description : "",
      content: typeof g.content === "string" ? g.content : "",
      links: Array.isArray(g.links) ? g.links.map(String) : undefined,
    }
    try {
      assertMemoryInput(input)
      assertPersonalName(input.name)
      const row = await saveMemory({
        type: input.type as MemoryType,
        name: input.name,
        description: input.description,
        content: input.content,
        links: input.links,
        sourceThreadId: threadId,
        source: "inference",
      })
      saved.push({ name: row.name, type: row.type })
    } catch {
      skipped++
    }
  }

  await touchInferredAt(threadId)
  return { threadId, threadTitle, saved, dropped, skipped, inferredAt }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm test -- tests/unit/chat-infer.test.ts
```
Expected: PASS — all 6 `chat-infer` tests green.

- [ ] **Step 5: Run the full suite + typecheck**

Run:
```bash
npm test
npx tsc --noEmit
```
Expected: 174 + 6 = 180 pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add my-app/lib/chat/infer.ts my-app/tests/unit/chat-infer.test.ts
git commit -m "feat(chat): two-pass memory inference module (extract + hygiene gate)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Server actions — `inferFromThreadAction` + `inferIdleThreadsAction`

**Files:**
- Modify: `my-app/app/admin/chat/actions.ts`
- Modify: `my-app/tests/unit/chat-actions.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/auth`; `inferMemoriesFromThread` + `InferenceSummary` from `@/lib/chat/infer`; `listIdleUnprocessedThreads` from `@/lib/db/chat`.
- Produces: `inferFromThreadAction(threadId): Promise<{ success: true; summary: InferenceSummary } | { success: false; error: string }>`; `inferIdleThreadsAction(): Promise<{ success: true; summaries: InferenceSummary[] } | { success: false; error: string }>`.

- [ ] **Step 1: Write the failing tests in `chat-actions.test.ts`**

In `my-app/tests/unit/chat-actions.test.ts`, extend the existing hoisted mocks. Replace the `chatMock` hoist and the `@/lib/db/chat` mock and add an `inferMock`:

```typescript
const authMock = vi.hoisted(() => ({ requireAdmin: vi.fn(), getCurrentUser: vi.fn(), isAdmin: vi.fn() }))
const chatMock = vi.hoisted(() => ({ setThreadModelPreference: vi.fn(), listIdleUnprocessedThreads: vi.fn() }))
const inferMock = vi.hoisted(() => ({ inferMemoriesFromThread: vi.fn() }))
const modelsMock = vi.hoisted(() => ({ MODEL_PREFERENCES: ["auto", "small", "medium", "large"] }))

vi.mock("@/lib/auth", () => ({
  requireAdmin: authMock.requireAdmin,
  getCurrentUser: authMock.getCurrentUser,
  isAdmin: authMock.isAdmin,
}))
vi.mock("@/lib/db/chat", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/chat")>("@/lib/db/chat")
  return {
    ...actual,
    setThreadModelPreference: chatMock.setThreadModelPreference,
    listIdleUnprocessedThreads: chatMock.listIdleUnprocessedThreads,
  }
})
vi.mock("@/lib/chat/infer", () => ({ inferMemoriesFromThread: inferMock.inferMemoriesFromThread }))
vi.mock("@/lib/chat/awareness", () => ({ refreshAwareness: vi.fn(), SiteCategory: undefined }))
vi.mock("@/lib/chat/models", () => ({ MODEL_PREFERENCES: modelsMock.MODEL_PREFERENCES }))

import { setThreadModelPreferenceAction, inferFromThreadAction, inferIdleThreadsAction } from "@/app/admin/chat/actions"
```

Append the new test blocks at the end of the file:

```typescript
describe("inferFromThreadAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the summary after requireAdmin", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    const summary = { threadId: "t1", threadTitle: "hi", saved: [{ name: "x", type: "user" }], dropped: 0, skipped: 0, inferredAt: "x" }
    inferMock.inferMemoriesFromThread.mockResolvedValue(summary)
    const res = await inferFromThreadAction("t1")
    expect(res.success).toBe(true)
    if (res.success) expect(res.summary).toBe(summary)
    expect(inferMock.inferMemoriesFromThread).toHaveBeenCalledWith("t1")
  })

  it("returns failure if requireAdmin throws", async () => {
    authMock.requireAdmin.mockRejectedValue(new Error("not admin"))
    const res = await inferFromThreadAction("t1")
    expect(res.success).toBe(false)
    expect(inferMock.inferMemoriesFromThread).not.toHaveBeenCalled()
  })

  it("returns failure if inference throws", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    inferMock.inferMemoriesFromThread.mockRejectedValue(new Error("mistral down"))
    const res = await inferFromThreadAction("t1")
    expect(res.success).toBe(false)
  })
})

describe("inferIdleThreadsAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("infers each idle thread and returns the summaries", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.listIdleUnprocessedThreads.mockResolvedValue([
      { id: "a", title: "a", updated_at: "x", last_inferred_at: null },
      { id: "b", title: "b", updated_at: "x", last_inferred_at: null },
    ])
    inferMock.inferMemoriesFromThread
      .mockResolvedValueOnce({ threadId: "a", threadTitle: "a", saved: [], dropped: 0, skipped: 0, inferredAt: "x" })
      .mockResolvedValueOnce({ threadId: "b", threadTitle: "b", saved: [{ name: "y", type: "user" }], dropped: 0, skipped: 0, inferredAt: "x" })
    const res = await inferIdleThreadsAction()
    expect(res.success).toBe(true)
    if (res.success) expect(res.summaries).toHaveLength(2)
    expect(chatMock.listIdleUnprocessedThreads).toHaveBeenCalledWith({ idleMinutes: 15, limit: 2 })
  })

  it("returns an empty summaries list when no idle threads", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.listIdleUnprocessedThreads.mockResolvedValue([])
    const res = await inferIdleThreadsAction()
    expect(res.success).toBe(true)
    if (res.success) expect(res.summaries).toEqual([])
    expect(inferMock.inferMemoriesFromThread).not.toHaveBeenCalled()
  })

  it("returns failure if requireAdmin throws", async () => {
    authMock.requireAdmin.mockRejectedValue(new Error("not admin"))
    const res = await inferIdleThreadsAction()
    expect(res.success).toBe(false)
  })

  it("continues past a single thread's inference failure", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.listIdleUnprocessedThreads.mockResolvedValue([
      { id: "a", title: "a", updated_at: "x", last_inferred_at: null },
      { id: "b", title: "b", updated_at: "x", last_inferred_at: null },
    ])
    inferMock.inferMemoriesFromThread
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ threadId: "b", threadTitle: "b", saved: [], dropped: 0, skipped: 0, inferredAt: "x" })
    const res = await inferIdleThreadsAction()
    expect(res.success).toBe(true)
    if (res.success) expect(res.summaries).toHaveLength(1) // only the survivor
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm test -- tests/unit/chat-actions.test.ts
```
Expected: FAIL — `inferFromThreadAction`/`inferIdleThreadsAction` not exported.

- [ ] **Step 3: Implement the actions in `app/admin/chat/actions.ts`**

In `my-app/app/admin/chat/actions.ts`, add imports at the top (extend the existing `@/lib/db/chat` import to include `listIdleUnprocessedThreads`, and add the infer import):

```typescript
import {
  listThreads,
  getThread,
  getMessages,
  listAllMemories,
  setMemoryActive,
  updateMemoryContent,
  setThreadModelPreference,
  listIdleUnprocessedThreads,
  type MemoryType,
  type ChatThread,
  type ChatMessageRow,
  type MemoryRow,
} from "@/lib/db/chat";
import { refreshAwareness, type SiteCategory } from "@/lib/chat/awareness";
import { MODEL_PREFERENCES, type ModelPreference } from "@/lib/chat/models";
import { inferMemoriesFromThread, type InferenceSummary } from "@/lib/chat/infer";
```

Append the two actions at the end of the file:

```typescript
export async function inferFromThreadAction(
  threadId: string
): Promise<{ success: true; summary: InferenceSummary } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const summary = await inferMemoriesFromThread(threadId);
    return { success: true, summary };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Inference failed" };
  }
}

export async function inferIdleThreadsAction(): Promise<
  { success: true; summaries: InferenceSummary[] } | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const idle = await listIdleUnprocessedThreads({ idleMinutes: 15, limit: 2 });
    const summaries: InferenceSummary[] = [];
    for (const t of idle) {
      try {
        summaries.push(await inferMemoriesFromThread(t.id));
      } catch {
        // one thread failing must not abort the rest
      }
    }
    return { success: true, summaries };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Inference failed" };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm test -- tests/unit/chat-actions.test.ts
```
Expected: PASS — existing + new inference action tests green.

- [ ] **Step 5: Run the full suite + typecheck**

Run:
```bash
npm test
npx tsc --noEmit
```
Expected: all tests pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add my-app/app/admin/chat/actions.ts my-app/tests/unit/chat-actions.test.ts
git commit -m "feat(chat): admin-gated infer actions (manual + idle piggyback)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Chat UI — "Save memories now" button

**Files:**
- Modify: `my-app/components/ChatUI.tsx`
- Modify: `my-app/app/globals.css`

**Interfaces:**
- Consumes: `inferFromThreadAction` from `@/app/admin/chat/actions`; the existing `activeId`, `streaming` state.
- Produces: a button + status line; no exported API.

Note: this repo has no React component test harness (all tests are Vitest unit tests on logic). Verification is `npm run build` + manual UI check (390 px), consistent with how the existing ChatUI was shipped.

- [ ] **Step 1: Add the button + state to `components/ChatUI.tsx`**

In `my-app/components/ChatUI.tsx`, add `useTransition` to the React import:

```typescript
import { useState, useRef, useCallback, useEffect, useTransition } from "react";
```

Add `inferFromThreadAction` to the actions import:

```typescript
import {
  listThreadsAction,
  getThreadAction,
  setThreadModelPreferenceAction,
  inferFromThreadAction,
  type ThreadSummary,
} from "@/app/admin/chat/actions";
```

Inside the component, after the existing state declarations (after `const [liveModel, setLiveModel] = useState<string | null>(null);`), add:

```typescript
  const [inferPending, startInferTransition] = useTransition();
  const [inferStatus, setInferStatus] = useState<string | null>(null);
```

Add an `inferNow` handler after the `newConversation` function:

```typescript
  const inferNow = () => {
    if (!activeId || streaming || inferPending) return;
    setInferStatus(null);
    startInferTransition(async () => {
      const res = await inferFromThreadAction(activeId);
      if (!res.success) {
        setInferStatus(`Error: ${res.error}`);
        return;
      }
      const { saved, dropped, skipped } = res.summary;
      if (saved.length === 0) {
        setInferStatus("No new memories worth keeping.");
      } else {
        const names = saved.map((s) => s.name).join(", ");
        setInferStatus(
          `Saved ${saved.length} memories: ${names}.${dropped ? ` Dropped ${dropped}.` : ""}${
            skipped ? ` Skipped ${skipped}.` : ""
          }`
        );
      }
    });
  };
```

Replace the `<div className="chat-head">…</div>` block with one that adds the "Save memories now" button alongside the model pill:

```tsx
        <div className="chat-head">
          <div className="chat-model-pill-wrap">
            <button
              type="button"
              className="chat-model-pill"
              onClick={() => setModelMenuOpen((o) => !o)}
              disabled={streaming || !activeId}
              aria-haspopup="menu"
              aria-expanded={modelMenuOpen}
              title="Change the Mistral model for this thread"
            >
              Model: {modelPref === "auto" ? `auto → ${liveModel ?? "medium"}` : modelPref}
            </button>
            {modelMenuOpen && (
              <div className="chat-model-menu" role="menu">
                {(["auto", "small", "medium", "large"] as ModelPreference[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`chat-model-option${p === modelPref ? " active" : ""}`}
                    role="menuitem"
                    onClick={async () => {
                      if (!activeId) return;
                      setModelMenuOpen(false);
                      const prev = modelPref;
                      setModelPref(p);
                      const res = await setThreadModelPreferenceAction(activeId, p);
                      if (!res.success) {
                        setModelPref(prev);
                        setError(res.error);
                      }
                    }}
                  >
                    {p}
                    {p === "auto" ? " (route by difficulty)" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="chat-infer-btn"
            onClick={inferNow}
            disabled={streaming || !activeId || inferPending}
            title="Read this conversation and save durable memories to the bank"
          >
            {inferPending ? "Inferring…" : "Save memories now"}
          </button>
        </div>

        {inferStatus && <div className="chat-infer-status">{inferStatus}</div>}
```

- [ ] **Step 2: Add the CSS to `app/globals.css`**

In `my-app/app/globals.css`, find the `.chat-head` rule (added for the model pill) and append the new styles after it (use only existing tokens):

```css
.chat-infer-btn {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--bg-card);
  color: var(--walnut);
  cursor: pointer;
}
.chat-infer-btn:hover:not(:disabled) {
  border-color: var(--terracotta);
  color: var(--terracotta);
}
.chat-infer-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.chat-infer-status {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--walnut-soft);
  padding: 6px 10px;
  border-radius: var(--radius);
  background: var(--bg-card);
  border: 1px solid var(--line);
  margin-bottom: 8px;
}
```

Find the existing `@media (max-width: 720px)` block that targets `.chat-head` and ensure the infer button wraps below the pill on mobile. Add (or merge into the existing mobile block):

```css
@media (max-width: 720px) {
  .chat-head {
    flex-wrap: wrap;
    gap: 8px;
  }
  .chat-infer-btn {
    width: 100%;
  }
}
```

- [ ] **Step 3: Build + typecheck**

Run:
```bash
npm run build
npx tsc --noEmit
```
Expected: build ✓ Compiled successfully; routes present include `/admin/chat`; tsc clean.

- [ ] **Step 4: Commit**

```bash
git add my-app/components/ChatUI.tsx my-app/app/globals.css
git commit -m "feat(chat): 'Save memories now' button in chat UI

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: MemoriesManager — picker, "Recently inferred" filter, badge, on-mount piggyback

**Files:**
- Modify: `my-app/components/MemoriesManager.tsx`
- Modify: `my-app/app/globals.css`

**Interfaces:**
- Consumes: `inferFromThreadAction`, `inferIdleThreadsAction`, `listThreadsAction` from `@/app/admin/chat/actions`; existing `listMemoriesAction`, `setMemoryActiveAction`, `updateMemoryContentAction`, `refreshAwarenessAction`.
- Produces: the extended MemoriesManager UI; no exported API.

Note: no React component test harness; verification is `npm run build` + manual 390 px check.

- [ ] **Step 1: Add the picker + filter + badge + piggyback to `MemoriesManager.tsx`**

In `my-app/components/MemoriesManager.tsx`, extend the imports:

```typescript
import { useState, useTransition, useEffect, useRef } from "react";
import {
  setMemoryActiveAction,
  updateMemoryContentAction,
  refreshAwarenessAction,
  listMemoriesAction,
  inferFromThreadAction,
  inferIdleThreadsAction,
  listThreadsAction,
  type ThreadSummary,
} from "@/app/admin/chat/actions";
import type { MemoryRow, MemoryType } from "@/lib/db/chat";
```

Inside the component, after the existing state declarations, add:

```typescript
  const [showPicker, setShowPicker] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [inferBanner, setInferBanner] = useState<string | null>(null);
  const piggybackFired = useRef(false);
```

Extend the `filter` type to include `"inferred"`:

```typescript
  const [filter, setFilter] = useState<MemoryType | "all" | "personal" | "site" | "inferred">("all");
```

Update the `filtered` computation to handle the new filter:

```typescript
  const filtered = memories.filter((m) => {
    if (filter === "all") return true;
    if (filter === "personal") return m.type !== "site";
    if (filter === "site") return m.type === "site";
    if (filter === "inferred") return m.source === "inference";
    return m.type === filter;
  });
```

Add an `inferFrom` handler and a piggyback effect after the `refresh` handler:

```typescript
  const inferFrom = (threadId: string) =>
    startTransition(async () => {
      const res = await inferFromThreadAction(threadId);
      if (res.success) {
        const { saved, dropped, skipped } = res.summary;
        setInferBanner(
          saved.length === 0
            ? "No new memories worth keeping."
            : `Saved ${saved.length}: ${saved.map((s) => s.name).join(", ")}.${dropped ? ` Dropped ${dropped}.` : ""}${skipped ? ` Skipped ${skipped}.` : ""}`
        );
      } else {
        setInferBanner(`Error: ${res.error}`);
      }
      setShowPicker(false);
      await reload();
    });

  // On-mount piggyback: infer ≤2 threads idle ≥15 min. Guarded against StrictMode
  // double-invoke. The last_inferred_at stamp + the "unprocessed" selector in
  // listIdleUnprocessedThreads prevent repeats on later visits.
  useEffect(() => {
    if (piggybackFired.current) return;
    piggybackFired.current = true;
    (async () => {
      const res = await inferIdleThreadsAction();
      if (res.success && res.summaries.length > 0) {
        const total = res.summaries.reduce((n, s) => n + s.saved.length, 0);
        if (total > 0) {
          setInferBanner(`Inferred ${total} new memories from ${res.summaries.length} idle thread(s). Review below.`);
          await reload();
        }
      }
    })();
  }, []);
```

Add a helper to resolve a thread title for the badge (after `byType`):

```typescript
  const titleFor = (m: MemoryRow) => {
    if (!m.source_thread_id) return null;
    const t = threads.find((th) => th.id === m.source_thread_id);
    return t ? t.title : null;
  };
```

Open the picker: add a "load threads" step to the `inferFrom` button. Add a `openPicker` handler before `renderCard`:

```typescript
  const openPicker = () =>
    startTransition(async () => {
      const list = await listThreadsAction();
      setThreads(list);
      setShowPicker(true);
    });
```

In the `renderCard` function, add the inferred badge inside the `mem-card-head` div, after the existing `mem-type-pill` span:

```tsx
          {m.source === "inference" && (
            <span className="mem-inferred-badge">· inferred{titleFor(m) ? ` from "${titleFor(m)}"` : ""}</span>
          )}
```

Add the new "Infer from a thread…" button and the picker UI inside the `mem-toolbar` div (after the "Refresh all site awareness" button):

```tsx
        <button className="mem-btn" onClick={openPicker} disabled={pending}>
          Infer from a thread…
        </button>
        {showPicker && (
          <div className="mem-picker">
            <div className="mem-picker-head">Pick a thread to infer memories from:</div>
            {threads.length === 0 && <div className="mem-picker-empty">No threads yet.</div>}
            {threads.map((t) => (
              <button
                key={t.id}
                className="mem-picker-item"
                onClick={() => inferFrom(t.id)}
                disabled={pending}
              >
                <span className="mem-picker-title">{t.title}</span>
                <span className="mem-picker-meta">{t.messageCount} msgs</span>
              </button>
            ))}
            <button className="mem-btn ghost" onClick={() => setShowPicker(false)} disabled={pending}>
              Cancel
            </button>
          </div>
        )}
```

Add the "inferred" filter chip to the filters row. Replace the existing filters `.map` line:

```tsx
          {(["all", "personal", "site", "inferred", ...TYPES] as const).map((f) => (
```

Add the banner above the empty-state / groups (after `{status && <div className="mem-status">{status}</div>}`):

```tsx
      {inferBanner && (
        <div className="mem-infer-banner">
          {inferBanner}
          <button className="mem-banner-dismiss" onClick={() => setInferBanner(null)}>
            ✕
          </button>
        </div>
      )}
```

- [ ] **Step 2: Add the CSS to `app/globals.css`**

Append after the memories styles (only existing tokens):

```css
.mem-picker {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--bg-card);
}
.mem-picker-head { font-family: var(--font-body); font-size: 13px; color: var(--walnut-soft); }
.mem-picker-empty { font-family: var(--font-body); font-size: 13px; color: var(--walnut-soft); }
.mem-picker-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--walnut);
  cursor: pointer;
  font-family: var(--font-body);
}
.mem-picker-item:hover:not(:disabled) { border-color: var(--terracotta); }
.mem-picker-title { font-weight: 600; }
.mem-picker-meta { font-size: 12px; color: var(--walnut-soft); }
.mem-inferred-badge { font-size: 12px; color: var(--walnut-soft); }
.mem-infer-banner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--terracotta);
  background: var(--bg-card);
  color: var(--walnut);
  font-family: var(--font-body);
  font-size: 13px;
  margin-bottom: 10px;
}
.mem-banner-dismiss {
  background: none;
  border: none;
  color: var(--walnut-soft);
  cursor: pointer;
  font-size: 14px;
}
```

Add to the existing mobile block so the picker item title/meta stack at 390 px:

```css
@media (max-width: 560px) {
  .mem-picker-item { flex-direction: column; gap: 2px; }
}
```

- [ ] **Step 3: Build + typecheck**

Run:
```bash
npm run build
npx tsc --noEmit
```
Expected: build ✓ Compiled successfully; routes present include `/admin/chat/memories`; tsc clean.

- [ ] **Step 4: Commit**

```bash
git add my-app/components/MemoriesManager.tsx my-app/app/globals.css
git commit -m "feat(chat): MemoriesManager picker + Recently inferred filter + idle piggyback

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Apply schema to prod, full verification, HANDOFF

**Files:**
- Modify: `HANDOFF.md` (project root)

**Interfaces:** none (release task).

- [ ] **Step 1: Apply the two new columns to prod Supabase**

Run (needs the Supabase access token; if `Unauthorized`, re-login via `npx supabase login --token <token>`):

```bash
cd "D:\claude projects\Pingusama's Repositories\pingusama-site-mockup-wheel\my-app"
npx supabase db query --linked "ALTER TABLE public.chat_threads ADD COLUMN IF NOT EXISTS last_inferred_at timestamptz NULL; ALTER TABLE public.chat_memories ADD COLUMN IF NOT EXISTS source text NULL DEFAULT 'chat';"
```

Then verify the columns exist:

```bash
npx supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('chat_threads','chat_memories') AND column_name IN ('last_inferred_at','source');"
```
Expected: 2 rows (`last_inferred_at`, `source`).

If the CLI is not linked, link first: `npx supabase link --project-ref kuyytbmmvxcmiyxqsnpe`.

- [ ] **Step 2: Full test + build + typecheck**

Run:
```bash
npm test
npm run build
npx tsc --noEmit
```
Expected: all tests pass (174 + new ≈ 186+); build ✓ Compiled successfully; routes present: `/admin/chat`, `/admin/chat/memories`, `/api/chat`, `/api/me`; tsc clean.

- [ ] **Step 3: Update HANDOFF.md**

Update `HANDOFF.md` with a new "What changed this session — Auto memory inference (2026-07-11)" section covering: the two-pass `lib/chat/infer.ts`, the `source` + `last_inferred_at` columns, the three triggers (chat-UI "Save memories now", MemoriesManager picker, on-mount idle piggyback), the security guarantee held (no site-write import in the inference path, both passes tool-less, `site:*` rejected), the test/build counts, and the manual checks pending (live inference smoke + 390 px, both needing the admin login).

Per the HANDOFF starter prompt rule, append a copyable next-session starter prompt to the HANDOFF update.

- [ ] **Step 4: Commit**

```bash
git add HANDOFF.md
git commit -m "docs: handoff for auto memory inference

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: Offer deploy + merge (do NOT run without the user's go-ahead)**

This step is informational only — do not deploy or merge until the user confirms. When they confirm, the sequence is:
1. (Optional) `npx supabase db query --linked …` — already done in Step 1.
2. `vercel --prod --yes` from `my-app/`.
3. `git checkout master && git merge feat/auto-memory-inference && git push origin master`.
4. Manual live smoke (the user's admin login): chat → "Save memories now"; MemoriesManager picker; leave a thread idle >15 min → reload MemoriesManager → banner; 390 px eyeball.

---

## Self-Review (run after writing)

**1. Spec coverage:**
- Two-pass inference (Approach C, large) → Task 2 ✓
- Auto-save via `saveMemory` (no candidate queue) → Task 2 (saves keeps) ✓
- `source` + `last_inferred_at` columns → Task 1 ✓
- Chat-UI "Save memories now" button → Task 4 ✓
- MemoriesManager "Infer from a thread…" picker → Task 5 ✓
- Background piggyback on MemoriesManager, idle ≥15 min, ≤2 → Task 5 (on-mount action) + Task 3 (`inferIdleThreadsAction`) ✓
- "Recently inferred" filter + badge → Task 5 ✓
- Security guarantee (no site-write import, tool-less passes, `site:*` rejected) → Task 2 module header + `assertPersonalName` in code ✓
- Admin-only (`requireAdmin`) → Task 3 ✓
- Schema additive/idempotent → Task 1 ✓
- Fraunces/Nunito tokens, 390 px → Tasks 4 & 5 CSS ✓
- `npm test` + `npm run build` + `tsc` → every task + Task 6 ✓
- HANDOFF update + starter prompt → Task 6 ✓
- Deferred: blog companion (Feature 2), external cron, "start a new thread" trigger → noted out-of-scope in spec, not in plan ✓

**2. Placeholder scan:** none — every step has complete code, exact commands, expected output.

**3. Type consistency:**
- `InferenceSummary` shape used identically in Task 2 (definition), Task 3 (action return), Task 4 (reads `saved/dropped/skipped`), Task 5 (reads `saved.length`/`summaries`) ✓
- `SaveMemoryInput.source` added in Task 1, consumed in Task 2 (`source: "inference"`) ✓
- `touchInferredAt` / `listIdleUnprocessedThreads` defined in Task 1, consumed in Task 2 + Task 3 ✓
- `MemoryRow.source` added in Task 1, read in Task 5 (`m.source === "inference"`) ✓
- `ChatThread.last_inferred_at` added in Task 1, used in Task 1 test + Task 3 test ✓
- `inferFromThreadAction` / `inferIdleThreadsAction` defined in Task 3, consumed in Tasks 4 & 5 ✓