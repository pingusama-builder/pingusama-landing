import { describe, it, expect, vi, beforeEach } from "vitest"

// Self-contained FakeClient matching tests/unit/companion-threads.test.ts, plus
// a .delete() chain method for the hard-delete functions under test.
class Query {
  table: string
  fake: FakeClient
  filters: Record<string, unknown[]> = {}
  payload: unknown = null
  sel: unknown = null
  isDelete = false
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
  delete() {
    this.isDelete = true
    this.payload = "__delete__"
    return this
  }
  eq(c: string, v: unknown) {
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
      isDelete: this.isDelete,
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
  calls: {
    table: string
    payload: unknown
    isDelete: boolean
    filters: Record<string, unknown[]>
  }[] = []
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
  deleteThread,
  deleteMemoriesSourcedFromThread,
  countMemoriesSourcedFromThread,
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

describe("deleteThread", () => {
  beforeEach(() => {
    holder.current = null
  })

  it("deletes a chat-purpose thread (DELETE on chat_threads WHERE id)", async () => {
    const f = fake()
    // 1) getChatThread select -> the chat thread
    f.push(baseThread({ id: "t1", purpose: "chat" }))
    // 2) the delete result
    f.push(null, null)
    const res = await deleteThread("t1")
    expect(res.deleted).toBe(true)
    const delCall = f.calls.find((c) => c.table === "chat_threads" && c.isDelete)
    expect(delCall, "chat_threads delete was issued").toBeDefined()
    expect(delCall?.filters.id).toContain("t1")
  })

  it("refuses a blog-companion thread (returns deleted:false, no delete issued)", async () => {
    const f = fake()
    // getChatThread returns null for purpose = 'blog-companion'
    f.push(baseThread({ id: "c1", purpose: "blog-companion" }))
    const res = await deleteThread("c1")
    expect(res.deleted).toBe(false)
    expect(f.calls.find((c) => c.isDelete)).toBeUndefined()
  })

  it("refuses an unknown id (returns deleted:false, no delete issued)", async () => {
    const f = fake()
    f.push(null)
    const res = await deleteThread("missing")
    expect(res.deleted).toBe(false)
    expect(f.calls.find((c) => c.isDelete)).toBeUndefined()
  })

  it("rethrows a delete error", async () => {
    const f = fake()
    f.push(baseThread({ id: "t1" }))
    f.push(null, { message: "rls denied" })
    await expect(deleteThread("t1")).rejects.toThrow("rls denied")
  })
})

describe("deleteMemoriesSourcedFromThread", () => {
  beforeEach(() => {
    holder.current = null
  })

  it("issues DELETE on chat_memories WHERE source_thread_id and returns the count", async () => {
    const f = fake()
    f.push([{ id: "m1" }, { id: "m2" }, { id: "m3" }], null)
    const n = await deleteMemoriesSourcedFromThread("t1")
    expect(n).toBe(3)
    const call = f.calls.find((c) => c.table === "chat_memories" && c.isDelete)
    expect(call, "chat_memories delete was issued").toBeDefined()
    expect(call?.filters.source_thread_id).toContain("t1")
  })

  it("returns 0 when no memories were sourced from the thread", async () => {
    const f = fake()
    f.push([], null)
    const n = await deleteMemoriesSourcedFromThread("t1")
    expect(n).toBe(0)
  })

  it("rethrows a delete error", async () => {
    const f = fake()
    f.push(null, { message: "boom" })
    await expect(deleteMemoriesSourcedFromThread("t1")).rejects.toThrow("boom")
  })
})

describe("countMemoriesSourcedFromThread", () => {
  beforeEach(() => {
    holder.current = null
  })

  it("returns the count of memories sourced from the thread", async () => {
    const f = fake()
    f.push([{ id: "m1" }, { id: "m2" }], null)
    const n = await countMemoriesSourcedFromThread("t1")
    expect(n).toBe(2)
    const call = f.calls.find((c) => c.table === "chat_memories" && !c.isDelete)
    expect(call?.filters.source_thread_id).toContain("t1")
  })

  it("returns 0 when none", async () => {
    const f = fake()
    f.push([], null)
    const n = await countMemoriesSourcedFromThread("t1")
    expect(n).toBe(0)
  })

  it("rethrows a query error", async () => {
    const f = fake()
    f.push(null, { message: "down" })
    await expect(countMemoriesSourcedFromThread("t1")).rejects.toThrow("down")
  })
})
