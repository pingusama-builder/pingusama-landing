import { describe, it, expect, vi, beforeEach } from "vitest"

// Reuse the FakeClient/Query chain mock pattern from chat-memory.test.ts.
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
    (this.filters[c] ??= []).push(v)
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
    this.fake.calls.push({ table: this.table, payload: this.payload, filters: this.filters })
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
  assertWritingPrefName,
  getChatThread,
  getCompanionThread,
  getOrCreateCompanionThread,
  listChatThreads,
  listIdleChatThreads,
  type ChatThread,
} from "@/lib/db/chat"

const baseThread = (over: Partial<ChatThread> = {}): ChatThread => ({
  id: "t-1",
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

function fake(): FakeClient {
  const f = new FakeClient()
  holder.current = f
  return f
}

describe("assertWritingPrefName", () => {
  it("accepts a writing- prefixed name", () => {
    expect(() => assertWritingPrefName("writing-prefers-fragments")).not.toThrow()
  })
  it("rejects a name without the writing- prefix", () => {
    expect(() => assertWritingPrefName("prefers-fragments")).toThrow(/writing-/)
  })
  it("rejects site:* even if writing- is absent", () => {
    expect(() => assertWritingPrefName("site:blog")).toThrow()
  })
  it("rejects site:writing-x (the site: guard wins)", () => {
    expect(() => assertWritingPrefName("site:writing-x")).toThrow()
  })
  it("still rejects an invalid kebab via assertPersonalName", () => {
    expect(() => assertWritingPrefName("writing-Bad Name")).toThrow()
  })
})

describe("getChatThread", () => {
  beforeEach(() => {
    holder.current = null
  })
  it("returns a chat-purpose thread", async () => {
    const f = fake()
    f.push(baseThread({ id: "t1", purpose: "chat" }))
    const t = await getChatThread("t1")
    expect(t?.id).toBe("t1")
  })
  it("returns null for a blog-companion thread (does not leak into chat)", async () => {
    const f = fake()
    f.push(baseThread({ id: "t2", purpose: "blog-companion" }))
    const t = await getChatThread("t2")
    expect(t).toBeNull()
  })
  it("returns null when the row does not exist", async () => {
    const f = fake()
    f.push(null)
    const t = await getChatThread("missing")
    expect(t).toBeNull()
  })
})

describe("getCompanionThread", () => {
  beforeEach(() => {
    holder.current = null
  })
  it("returns the thread when purpose + subject match", async () => {
    const f = fake()
    f.push(
      baseThread({
        id: "c1",
        purpose: "blog-companion",
        subject_type: "post",
        subject_key: "post-123",
      })
    )
    const t = await getCompanionThread("c1", { subjectType: "post", subjectKey: "post-123" })
    expect(t?.id).toBe("c1")
  })
  it("returns null when subject_type mismatches", async () => {
    const f = fake()
    f.push(
      baseThread({
        id: "c1",
        purpose: "blog-companion",
        subject_type: "post",
        subject_key: "post-123",
      })
    )
    const t = await getCompanionThread("c1", { subjectType: "draft", subjectKey: "draft:abc" })
    expect(t).toBeNull()
  })
  it("returns null for a chat-purpose thread", async () => {
    const f = fake()
    f.push(baseThread({ id: "c2", purpose: "chat", subject_type: null, subject_key: null }))
    const t = await getCompanionThread("c2", { subjectType: "post", subjectKey: "post-123" })
    expect(t).toBeNull()
  })
})

describe("getOrCreateCompanionThread", () => {
  beforeEach(() => {
    holder.current = null
  })
  it("returns the existing thread when one matches the subject", async () => {
    const f = fake()
    f.push(
      baseThread({
        id: "c1",
        purpose: "blog-companion",
        subject_type: "post",
        subject_key: "post-123",
      })
    )
    const t = await getOrCreateCompanionThread({ subjectType: "post", subjectKey: "post-123" })
    expect(t.id).toBe("c1")
    // No insert attempted (only one result consumed).
    expect(f.results).toHaveLength(0)
  })
  it("inserts a new companion thread when none exists", async () => {
    const f = fake()
    // 1) select existing -> none
    f.push(null)
    // 2) insert -> the new row
    f.push(
      baseThread({
        id: "c-new",
        purpose: "blog-companion",
        subject_type: "draft",
        subject_key: "draft:abc",
      })
    )
    const t = await getOrCreateCompanionThread({ subjectType: "draft", subjectKey: "draft:abc" })
    expect(t.id).toBe("c-new")
    expect(t.purpose).toBe("blog-companion")
    expect(t.subject_key).toBe("draft:abc")
  })
  it("reselects after a concurrent-insert unique violation (arbitration)", async () => {
    const f = fake()
    // 1) select existing -> none
    f.push(null)
    // 2) insert -> unique violation error
    f.push(null, { message: "duplicate key value violates unique constraint" })
    // 3) reselect -> the row the concurrent request created
    f.push(
      baseThread({
        id: "c-race",
        purpose: "blog-companion",
        subject_type: "post",
        subject_key: "post-9",
      })
    )
    const t = await getOrCreateCompanionThread({ subjectType: "post", subjectKey: "post-9" })
    expect(t.id).toBe("c-race")
  })
})

describe("listChatThreads / listIdleChatThreads (chat-scoped)", () => {
  beforeEach(() => {
    holder.current = null
  })
  it("listChatThreads filters purpose = 'chat'", async () => {
    const f = fake()
    f.push([baseThread({ id: "t1", purpose: "chat" })])
    await listChatThreads(10)
    const call = f.calls.find((c) => c.table === "chat_threads")
    expect(call).toBeDefined()
    expect(call?.filters.purpose).toContain("chat")
  })
  it("listIdleChatThreads filters purpose = 'chat'", async () => {
    const f = fake()
    f.push([])
    await listIdleChatThreads({ idleMinutes: 15, limit: 2 })
    const call = f.calls.find((c) => c.table === "chat_threads")
    expect(call?.filters.purpose).toContain("chat")
  })
})