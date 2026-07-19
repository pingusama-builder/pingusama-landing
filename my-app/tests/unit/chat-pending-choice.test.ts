import { describe, it, expect, vi, beforeEach } from "vitest"

// Chainable fake for the Supabase service client (mirrors chat-memory.test.ts,
// plus `.is()` used by resolvePendingChoice). Each terminal call resolves to
// the next queued {data,error} so tests drive each branch.
class Query {
  table: string
  fake: FakeClient
  filters: Record<string, unknown[]> = {}
  nullFilters: Record<string, boolean> = {}
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
  is(c: string, v: null) {
    this.nullFilters[c] = v === null
    return this
  }
  maybeSingle() {
    return Promise.resolve(this.consume())
  }
  single() {
    return Promise.resolve(this.consume())
  }
  consume() {
    const r = this.fake.results.shift() ?? { data: null, error: null }
    this.fake.calls.push({
      table: this.table,
      payload: this.payload,
      filters: this.filters,
      nullFilters: this.nullFilters,
    })
    return r
  }
}

class FakeClient {
  results: { data: unknown; error: unknown }[] = []
  calls: {
    table: string
    payload: unknown
    filters: Record<string, unknown[]>
    nullFilters: Record<string, boolean>
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
  insertPendingChoice,
  loadPendingChoice,
  resolvePendingChoice,
} from "@/lib/db/chat"

function fake() {
  const c = new FakeClient()
  holder.current = c
  return c
}

describe("insertPendingChoice", () => {
  beforeEach(() => {
    holder.current = null
  })

  it("inserts reason + subject + message_text + thread/user ids, returns the row", async () => {
    const c = fake()
    c.push({
      id: "p1",
      thread_id: "t1",
      user_message_id: "m1",
      reason: "external-prerequisites",
      subject: "Kubernetes",
      message_text: "which are the prerequisites for Kubernetes?",
      created_at: "2026-07-19T00:00:00Z",
      resolved_at: null,
      choice: null,
    })
    const row = await insertPendingChoice({
      threadId: "t1",
      userMessageId: "m1",
      reason: "external-prerequisites",
      subject: "Kubernetes",
      messageText: "which are the prerequisites for Kubernetes?",
    })
    expect(row.id).toBe("p1")
    expect(row.thread_id).toBe("t1")
    expect(row.user_message_id).toBe("m1")
    expect(c.calls).toHaveLength(1)
    expect(c.calls[0].table).toBe("pending_source_choices")
    expect(c.calls[0].payload).toEqual({
      thread_id: "t1",
      user_message_id: "m1",
      reason: "external-prerequisites",
      subject: "Kubernetes",
      message_text: "which are the prerequisites for Kubernetes?",
    })
  })

  it("normalizes a null/undefined subject to null", async () => {
    const c = fake()
    c.push({
      id: "p2",
      thread_id: "t1",
      user_message_id: "m1",
      reason: "current-public-facts",
      subject: null,
      message_text: "how are the reviews putting it in the canon?",
      created_at: "2026-07-19T00:00:00Z",
      resolved_at: null,
      choice: null,
    })
    await insertPendingChoice({
      threadId: "t1",
      userMessageId: "m1",
      reason: "current-public-facts",
      messageText: "how are the reviews putting it in the canon?",
    })
    expect(c.calls[0].payload).toMatchObject({ subject: null })
  })

  it("rejects an invalid reason (defense against malformed detector output)", async () => {
    fake()
    await expect(
      insertPendingChoice({
        threadId: "t1",
        userMessageId: "m1",
        // @ts-expect-error intentional invalid
        reason: "not-a-real-reason",
        messageText: "x",
      })
    ).rejects.toThrow(/Invalid suggestion reason/)
  })
})

describe("loadPendingChoice", () => {
  beforeEach(() => {
    holder.current = null
  })

  it("loads by id scoped to the thread (thread-id mismatch → null)", async () => {
    const c = fake()
    c.push({
      id: "p1",
      thread_id: "t1",
      user_message_id: "m1",
      reason: "external-prerequisites",
      subject: "Kubernetes",
      message_text: "…",
      created_at: "2026-07-19T00:00:00Z",
      resolved_at: null,
      choice: null,
    })
    const row = await loadPendingChoice("p1", "t1")
    expect(row?.id).toBe("p1")
    expect(c.calls[0].table).toBe("pending_source_choices")
    // Both id and thread_id are filtered (thread-scoped lookup).
    expect(c.calls[0].filters.id).toEqual(["p1"])
    expect(c.calls[0].filters.thread_id).toEqual(["t1"])
  })

  it("returns null when no row matches", async () => {
    const c = fake()
    c.push(null)
    expect(await loadPendingChoice("missing", "t1")).toBeNull()
  })
})

describe("resolvePendingChoice", () => {
  beforeEach(() => {
    holder.current = null
  })

  it("sets resolved_at + choice, gated on resolved_at IS NULL (idempotent guard)", async () => {
    const c = fake()
    c.push({
      id: "p1",
      thread_id: "t1",
      user_message_id: "m1",
      reason: "external-prerequisites",
      subject: "Kubernetes",
      message_text: "…",
      created_at: "2026-07-19T00:00:00Z",
      resolved_at: "2026-07-19T00:00:05Z",
      choice: "search",
    })
    const row = await resolvePendingChoice("p1", "search")
    expect(row?.choice).toBe("search")
    expect(row?.resolved_at).toBeTruthy()
    expect(c.calls[0].payload).toMatchObject({ choice: "search" })
    expect(c.calls[0].payload).toHaveProperty("resolved_at")
    expect(c.calls[0].filters.id).toEqual(["p1"])
    expect(c.calls[0].nullFilters.resolved_at).toBe(true)
  })

  it("returns null when already resolved (the .is(resolved_at, null) guard filters it out)", async () => {
    const c = fake()
    c.push(null)
    expect(await resolvePendingChoice("p1", "stay")).toBeNull()
  })

  it("rejects an invalid choice", async () => {
    fake()
    await expect(
      // @ts-expect-error intentional invalid
      resolvePendingChoice("p1", "maybe")
    ).rejects.toThrow(/Invalid source choice/)
  })
})