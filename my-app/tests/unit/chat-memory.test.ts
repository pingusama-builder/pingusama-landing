import { describe, it, expect, vi, beforeEach } from "vitest"

// A tiny chainable fake for the Supabase service client. The chat data layer
// builds queries with select/insert/update/eq/neq/in/order/limit and resolves
// them via maybeSingle()/single()/await. We record calls and resolve each
// terminal call to the next queued {data,error} so tests can drive each branch.
class Query {
  table: string
  fake: FakeClient
  filters: Record<string, unknown[]> = {}
  payload: unknown = null
  sel: unknown = null

  constructor(table: string, fake: FakeClient) {
    this.table = table
    this.fake = fake
  }
  select(s: unknown) {
    this.sel = s
    return this
  }
  insert(p: unknown) {
    this.payload = p
    return this
  }
  update(p: unknown) {
    this.payload = p
    return this
  }
  eq(c: string, v: unknown) {
    ;(this.filters[c] ??= []).push(v)
    return this
  }
  neq(c: string, v: unknown) {
    ;(this.filters[c] ??= []).push(v)
    return this
  }
  in(c: string, v: unknown) {
    this.filters[c] = Array.isArray(v) ? v : [v]
    return this
  }
  lt(c: string, v: unknown) {
    ;(this.filters[c] ??= []).push(v)
    return this
  }
  order() {
    return this
  }
  limit() {
    return this
  }
  consume() {
    const r = this.fake.results.shift() ?? { data: null, error: null }
    this.fake.calls.push({
      table: this.table,
      payload: this.payload,
      filters: this.filters,
    })
    return r
  }
  maybeSingle() {
    return Promise.resolve(this.consume())
  }
  single() {
    return Promise.resolve(this.consume())
  }
  then(onF: any, onR: any) {
    return Promise.resolve(this.consume()).then(onF, onR)
  }
}

class FakeClient {
  results: { data: unknown; error: unknown }[] = []
  calls: { table: string; payload: unknown; filters: Record<string, unknown[]> }[] = []
  push(data: unknown = null, error: unknown = null) {
    this.results.push({ data, error })
  }
  from(table: string) {
    return new Query(table, this)
  }
}

const holder = vi.hoisted(() => ({ current: null as FakeClient | null }))
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => holder.current,
}))

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

import {
  setThreadModelPreference,
  setOneTurnOverride,
  consumeOneTurnOverride,
  createThread,
  appendMessage,
  type ChatThread,
} from "@/lib/db/chat"

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

describe("name + input validation", () => {
  it("accepts kebab and namespaced names", () => {
    expect(isValidName("prefers-terracotta")).toBe(true)
    expect(isValidName("site:blog")).toBe(true)
    expect(isValidName("ai-post-series-idea")).toBe(true)
    expect(isValidName("a")).toBe(true)
  })
  it("rejects bad names", () => {
    expect(isValidName("Prefers")).toBe(false) // uppercase
    expect(isValidName("-leading")).toBe(false) // leading hyphen
    expect(isValidName("has space")).toBe(false)
    expect(isValidName("x".repeat(81))).toBe(false) // too long
  })

  it("assertMemoryInput passes for a valid personal memory", () => {
    expect(() =>
      assertMemoryInput({
        type: "feedback",
        name: "prefers-terracotta",
        description: "likes warm terracotta accents",
        content: "Prefers terracotta accents.",
      })
    ).not.toThrow()
  })

  it("rejects an invalid type", () => {
    expect(() =>
      assertMemoryInput({ type: "weird", name: "ok-name", description: "d", content: "c" })
    ).toThrow(/Invalid memory type/)
  })

  it("rejects an invalid name", () => {
    expect(() =>
      assertMemoryInput({ type: "user", name: "Bad Name", description: "d", content: "c" })
    ).toThrow(/Invalid memory name/)
  })

  it("rejects over-long description and content", () => {
    expect(() =>
      assertMemoryInput({
        type: "user",
        name: "ok-name",
        description: "x".repeat(MAX_DESCRIPTION + 1),
        content: "c",
      })
    ).toThrow(/Description too long/)
    expect(() =>
      assertMemoryInput({
        type: "user",
        name: "ok-name",
        description: "d",
        content: "x".repeat(MAX_CONTENT + 1),
      })
    ).toThrow(/Content too long/)
  })

  it("rejects invalid link names", () => {
    expect(() =>
      assertMemoryInput({
        type: "user",
        name: "ok-name",
        description: "d",
        content: "c",
        links: ["Bad Link"],
      })
    ).toThrow(/Links must each be a valid memory name/)
  })
})

describe("assertPersonalName (site:* namespace guard)", () => {
  it("rejects names owned by refresh_awareness", () => {
    expect(() => assertPersonalName("site:blog")).toThrow(/managed by refresh_awareness/)
    expect(() => assertPersonalName("site:shelf")).toThrow()
  })
  it("allows personal names", () => {
    expect(() => assertPersonalName("prefers-terracotta")).not.toThrow()
  })
})

describe("saveMemory", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })

  it("inserts when no active memory with that name exists", async () => {
    const fake = holder.current!
    fake.push(null) // maybeSingle → no existing
    const inserted = baseRow({ name: "prefers-terracotta", type: "user" })
    fake.push(inserted) // insert.single

    const row = await saveMemory({
      type: "user",
      name: "prefers-terracotta",
      description: "likes warm terracotta accents",
      content: "Prefers terracotta accents.",
    })

    expect(row.name).toBe("prefers-terracotta")
    // First call probed for an existing row; second inserted.
    expect(fake.calls[0].table).toBe("chat_memories")
    expect(fake.calls[1].payload).toMatchObject({
      type: "user",
      name: "prefers-terracotta",
      active: true,
    })
  })

  it("updates the existing row when an active memory with that name exists (dedupe, not duplicate)", async () => {
    const fake = holder.current!
    fake.push({ id: "existing-id" }) // maybeSingle → existing
    const updated = baseRow({ id: "existing-id", name: "prefers-terracotta" })
    fake.push(updated) // update.single

    const row = await saveMemory({
      type: "user",
      name: "prefers-terracotta",
      description: "refined summary",
      content: "Refined content.",
    })

    expect(row.id).toBe("existing-id")
    expect(fake.calls[1].payload).toMatchObject({
      name: "prefers-terracotta",
      content: "Refined content.",
    })
    // The update must target the existing row by id.
    expect(fake.calls[1].filters.id).toContain("existing-id")
  })

  it("rejects a site:* name so the bot cannot clobber awareness via save_memory", async () => {
    holder.current = new FakeClient()
    await expect(
      saveMemory({
        type: "user",
        name: "site:blog",
        description: "x",
        content: "y",
      })
    ).rejects.toThrow(/managed by refresh_awareness/)
  })
})

describe("updateMemory", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })

  it("updates by name and returns the row", async () => {
    const fake = holder.current!
    const updated = baseRow({ name: "prefers-terracotta" })
    fake.push(updated) // update...maybeSingle

    const row = await updateMemory("prefers-terracotta", { content: "new" })
    expect(row.name).toBe("prefers-terracotta")
    expect(fake.calls[0].payload).toMatchObject({ content: "new" })
  })

  it("throws when no active memory with that name exists", async () => {
    holder.current!.push(null) // update...maybeSingle → no row
    await expect(updateMemory("ghost-name", { content: "x" })).rejects.toThrow(
      /No active memory/
    )
  })

  it("rejects a site:* name", async () => {
    await expect(updateMemory("site:blog", { content: "x" })).rejects.toThrow(
      /managed by refresh_awareness/
    )
  })
})

describe("deleteMemory", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })
  it("soft-deletes by setting active=false", async () => {
    const fake = holder.current!
    fake.push(null, null) // update(...).then → { error: null }
    await deleteMemory("prefers-terracotta")
    expect(fake.calls[0].payload).toMatchObject({ active: false })
    expect(fake.calls[0].filters.name).toContain("prefers-terracotta")
  })
  it("rejects a site:* name", async () => {
    await expect(deleteMemory("site:blog")).rejects.toThrow(/managed by refresh_awareness/)
  })
})

describe("recallMemories", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })
  it("returns active memories and bumps last_used_at", async () => {
    const fake = holder.current!
    const rows = [baseRow({ id: "a" }), baseRow({ id: "b", type: "site", name: "site:blog" })]
    fake.push(rows) // list query
    fake.push(null, null) // bump update .then

    const out = await recallMemories({ limit: 10 })
    expect(out).toHaveLength(2)
    // The bump update targets the returned ids.
    expect(fake.calls[1].filters.id).toEqual(["a", "b"])
  })
  it("can exclude site awareness", async () => {
    const fake = holder.current!
    fake.push([baseRow({ id: "a" })])
    fake.push(null, null)
    await recallMemories({ includeSite: false })
    // First call should carry a `type` neq filter (active=true + type neq site).
    expect(fake.calls[0].filters.type).toBeDefined()
  })
})

describe("upsertSiteAwareness (fingerprint + delta diff)", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })

  it("inserts on first sync and reports everything as added", async () => {
    const fake = holder.current!
    fake.push(null) // no existing
    fake.push(baseRow({ name: "site:blog", links: ["p1", "p2"], fingerprint: "fp1" }))
    const res = await upsertSiteAwareness({
      category: "blog",
      description: "blog awareness",
      content: "# Blog",
      keys: ["p1", "p2"],
      fingerprint: "fp1",
    })
    expect(res.changed).toBe(true)
    expect(res.added).toEqual(["p1", "p2"])
    expect(res.removed).toEqual([])
  })

  it("reports unchanged when the fingerprint matches (no rewrite)", async () => {
    const fake = holder.current!
    const prev = baseRow({
      name: "site:blog",
      type: "site",
      links: ["p1", "p2"],
      fingerprint: "fp1",
      content: "# Blog (stored)",
    })
    fake.push(prev) // existing
    fake.push({ ...prev }) // update.single
    const res = await upsertSiteAwareness({
      category: "blog",
      description: "blog awareness",
      content: "# Blog (new)",
      keys: ["p1", "p2"],
      fingerprint: "fp1",
    })
    expect(res.changed).toBe(false)
    expect(res.added).toEqual([])
    expect(res.removed).toEqual([])
  })

  it("computes added/removed deltas when the set changes", async () => {
    const fake = holder.current!
    const prev = baseRow({
      name: "site:blog",
      type: "site",
      links: ["p1", "p2"],
      fingerprint: "fp1",
    })
    fake.push(prev)
    fake.push({ ...prev, links: ["p1", "p3"], fingerprint: "fp2" })
    const res = await upsertSiteAwareness({
      category: "blog",
      description: "blog awareness",
      content: "# Blog",
      keys: ["p1", "p3"],
      fingerprint: "fp2",
    })
    expect(res.changed).toBe(true)
    expect(res.added).toEqual(["p3"])
    expect(res.removed).toEqual(["p2"])
  })
})

const baseThread = (over: Partial<ChatThread> = {}): ChatThread => ({
  id: "t1",
  title: "New conversation",
  created_at: "2026-07-11T00:00:00Z",
  updated_at: "2026-07-11T00:00:00Z",
  model_preference: null,
  one_turn_override: null,
  last_inferred_at: null,
  purpose: "chat",
  subject_type: null,
  subject_key: null,
  ...over,
})

describe("setThreadModelPreference", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })
  it("writes model_preference on the thread", async () => {
    const fake = holder.current!
    fake.push(null, null) // update(...).then → { error: null }
    await setThreadModelPreference("t1", "large")
    expect(fake.calls[0].table).toBe("chat_threads")
    expect(fake.calls[0].payload).toMatchObject({ model_preference: "large" })
    expect(fake.calls[0].filters.id).toContain("t1")
  })
})

describe("setOneTurnOverride", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })
  it("writes one_turn_override on the thread", async () => {
    const fake = holder.current!
    fake.push(null, null)
    await setOneTurnOverride("t1", "large")
    expect(fake.calls[0].payload).toMatchObject({ one_turn_override: "large" })
  })
})

describe("consumeOneTurnOverride", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })
  it("returns the stored override and clears it", async () => {
    const fake = holder.current!
    // select(...).eq(...).maybeSingle() → the stored row
    fake.push(baseThread({ id: "t1", one_turn_override: "large" }))
    // update(...).eq(...) clearing it → { error: null } via .then
    fake.push(null, null)
    const out = await consumeOneTurnOverride("t1")
    expect(out).toBe("large")
    // The clearing update set one_turn_override = null.
    expect(fake.calls[1].payload).toMatchObject({ one_turn_override: null })
  })
  it("returns null when no override is stored", async () => {
    const fake = holder.current!
    fake.push(baseThread({ id: "t1", one_turn_override: null }))
    const out = await consumeOneTurnOverride("t1")
    expect(out).toBeNull()
    // No clearing update needed when already null.
    expect(fake.calls).toHaveLength(1)
  })
})

describe("createThread (with modelPreference)", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })
  it("persists model_preference when provided", async () => {
    const fake = holder.current!
    fake.push(baseThread({ id: "t-new", model_preference: "large" })) // insert.single
    const t = await createThread("Hi", "large")
    expect(t.model_preference).toBe("large")
    expect(fake.calls[0].payload).toMatchObject({ title: "Hi", model_preference: "large" })
  })
})

describe("appendMessage (with model)", () => {
  beforeEach(() => {
    holder.current = new FakeClient()
  })
  it("persists model on the row and touches the thread", async () => {
    const fake = holder.current!
    fake.push({ id: "m1", thread_id: "t1", role: "assistant", content: "hi", tool_calls: null, model: "mistral-large-latest", created_at: "x" }) // insert.single
    fake.push(null, null) // touchThread update .then
    const row = await appendMessage({ threadId: "t1", role: "assistant", content: "hi", model: "mistral-large-latest" })
    expect(row.model).toBe("mistral-large-latest")
    expect(fake.calls[0].payload).toMatchObject({ model: "mistral-large-latest" })
  })
})

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