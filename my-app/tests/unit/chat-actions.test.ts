import { describe, it, expect, vi, beforeEach } from "vitest"

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

describe("setThreadModelPreferenceAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes a valid preference after requireAdmin", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.setThreadModelPreference.mockResolvedValue(undefined)
    const res = await setThreadModelPreferenceAction("t1", "large")
    expect(res.success).toBe(true)
    expect(chatMock.setThreadModelPreference).toHaveBeenCalledWith("t1", "large")
  })

  it("rejects an invalid preference without touching the DB", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    const res = await setThreadModelPreferenceAction("t1", "enormous" as any)
    expect(res.success).toBe(false)
    expect(chatMock.setThreadModelPreference).not.toHaveBeenCalled()
  })

  it("returns failure if requireAdmin throws", async () => {
    authMock.requireAdmin.mockRejectedValue(new Error("not admin"))
    const res = await setThreadModelPreferenceAction("t1", "small")
    expect(res.success).toBe(false)
  })
})

describe("inferFromThreadAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the summary after requireAdmin", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    const summary = { threadId: "t1", threadTitle: "hi", saved: [{ name: "x", type: "user" }], dropped: 0, skipped: 0, scanned: 2, inferredAt: "x" }
    inferMock.inferMemoriesFromThread.mockResolvedValue(summary)
    const res = await inferFromThreadAction("t1")
    expect(res.success).toBe(true)
    if (res.success) expect(res.summary).toBe(summary)
    expect(inferMock.inferMemoriesFromThread).toHaveBeenCalledWith("t1", undefined)
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

  it("passes forceFull through to inferMemoriesFromThread", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    inferMock.inferMemoriesFromThread.mockResolvedValue({
      threadId: "t1",
      threadTitle: "hi",
      saved: [],
      dropped: 0,
      skipped: 0,
      scanned: 4,
      inferredAt: "x",
    })
    await inferFromThreadAction("t1", { forceFull: true })
    expect(inferMock.inferMemoriesFromThread).toHaveBeenCalledWith("t1", { forceFull: true })
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
      .mockResolvedValueOnce({ threadId: "a", threadTitle: "a", saved: [], dropped: 0, skipped: 0, scanned: 0, inferredAt: "x" })
      .mockResolvedValueOnce({ threadId: "b", threadTitle: "b", saved: [{ name: "y", type: "user" }], dropped: 0, skipped: 0, scanned: 0, inferredAt: "x" })
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
      .mockResolvedValueOnce({ threadId: "b", threadTitle: "b", saved: [], dropped: 0, skipped: 0, scanned: 0, inferredAt: "x" })
    const res = await inferIdleThreadsAction()
    expect(res.success).toBe(true)
    if (res.success) expect(res.summaries).toHaveLength(1) // only the survivor
  })
})
