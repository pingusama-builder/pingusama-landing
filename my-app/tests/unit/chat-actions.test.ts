import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.hoisted(() => ({ requireAdmin: vi.fn(), getCurrentUser: vi.fn(), isAdmin: vi.fn() }))
const chatMock = vi.hoisted(() => ({
  setThreadModelPreference: vi.fn(),
  listIdleUnprocessedThreads: vi.fn(),
  getChatThread: vi.fn(),
  getMessages: vi.fn(),
  listThreads: vi.fn(),
  countMemoriesSourcedFromThread: vi.fn(),
  deleteMemoriesSourcedFromThread: vi.fn(),
  deleteThread: vi.fn(),
}))
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
    getChatThread: chatMock.getChatThread,
    getMessages: chatMock.getMessages,
    listThreads: chatMock.listThreads,
    countMemoriesSourcedFromThread: chatMock.countMemoriesSourcedFromThread,
    deleteMemoriesSourcedFromThread: chatMock.deleteMemoriesSourcedFromThread,
    deleteThread: chatMock.deleteThread,
  }
})
vi.mock("@/lib/chat/infer", () => ({ inferMemoriesFromThread: inferMock.inferMemoriesFromThread }))
vi.mock("@/lib/chat/awareness", () => ({ refreshAwareness: vi.fn(), SiteCategory: undefined }))
vi.mock("@/lib/chat/models", () => ({ MODEL_PREFERENCES: modelsMock.MODEL_PREFERENCES }))

import { setThreadModelPreferenceAction, inferFromThreadAction, inferIdleThreadsAction, getThreadDebugLogAction, listThreadsAction, deleteThreadAction } from "@/app/admin/chat/actions"

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

describe("getThreadDebugLogAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the structured debug log for a chat thread", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.getChatThread.mockResolvedValue({
      id: "t1",
      title: "Hi",
      created_at: "2026-07-17T00:00:00Z",
      updated_at: "2026-07-17T01:00:00Z",
      model_preference: "auto",
      one_turn_override: null,
      purpose: "chat",
      subject_type: null,
      subject_key: null,
      last_inferred_at: null,
    })
    chatMock.getMessages.mockResolvedValue([
      { id: "m1", thread_id: "t1", role: "user", content: "hi", tool_calls: null, model: null, reasoning: null, telemetry: null, created_at: "2026-07-17T00:00:05Z" },
      {
        id: "m2", thread_id: "t1", role: "assistant", content: "hello", tool_calls: null, model: "mistral-medium-3-5",
        reasoning: "thinking…",
        telemetry: { response_model: "mistral-medium-3-5", reasoning_effort_sent: "high", reasoning_chars: 9, text_chars: 5, finish_reason: "stop" },
        created_at: "2026-07-17T00:00:06Z",
      },
    ])
    const res = await getThreadDebugLogAction("t1")
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.log.thread.id).toBe("t1")
      expect(res.log.thread.model_preference).toBe("auto")
      expect(res.log.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(res.log.messages).toHaveLength(2)
      expect(res.log.messages[1].reasoning).toBe("thinking…")
      expect(res.log.messages[1].telemetry).toMatchObject({ response_model: "mistral-medium-3-5", reasoning_effort_sent: "high" })
    }
    expect(chatMock.getChatThread).toHaveBeenCalledWith("t1")
  })

  it("rejects a non-chat (companion) thread with success:false", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.getChatThread.mockResolvedValue(null) // null for companion-purpose or unknown
    const res = await getThreadDebugLogAction("c1")
    expect(res.success).toBe(false)
    expect(chatMock.getMessages).not.toHaveBeenCalled()
  })

  it("returns failure if requireAdmin throws", async () => {
    authMock.requireAdmin.mockRejectedValue(new Error("not admin"))
    const res = await getThreadDebugLogAction("t1")
    expect(res.success).toBe(false)
    expect(chatMock.getChatThread).not.toHaveBeenCalled()
  })
})

describe("listThreadsAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("populates messageCount + sourcedMemoryCount per thread", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.listThreads.mockResolvedValue([
      { id: "t1", title: "a", updated_at: "x", purpose: "chat" },
      { id: "t2", title: "b", updated_at: "y", purpose: "chat" },
    ])
    chatMock.getMessages
      .mockResolvedValueOnce([{ id: "m1" }, { id: "m2" }])
      .mockResolvedValueOnce([{ id: "m3" }])
    chatMock.countMemoriesSourcedFromThread
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0)
    const out = await listThreadsAction()
    expect(out).toEqual([
      { id: "t1", title: "a", updated_at: "x", messageCount: 2, sourcedMemoryCount: 3 },
      { id: "t2", title: "b", updated_at: "y", messageCount: 1, sourcedMemoryCount: 0 },
    ])
  })

  it("returns failure if requireAdmin throws", async () => {
    authMock.requireAdmin.mockRejectedValue(new Error("not admin"))
    await expect(listThreadsAction()).rejects.toThrow("not admin")
  })
})

describe("deleteThreadAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("deletes the thread and returns memoriesDeleted:0 when alsoDeleteMemories is false", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.getChatThread.mockResolvedValue({ id: "t1", purpose: "chat" })
    chatMock.deleteThread.mockResolvedValue({ deleted: true })
    const res = await deleteThreadAction("t1", { alsoDeleteMemories: false })
    expect(res.success).toBe(true)
    if (res.success) expect(res.memoriesDeleted).toBe(0)
    expect(chatMock.deleteMemoriesSourcedFromThread).not.toHaveBeenCalled()
    expect(chatMock.deleteThread).toHaveBeenCalledWith("t1")
  })

  it("deletes sourced memories first, then the thread, and returns the count", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.getChatThread.mockResolvedValue({ id: "t1", purpose: "chat" })
    chatMock.deleteMemoriesSourcedFromThread.mockResolvedValue(4)
    chatMock.deleteThread.mockResolvedValue({ deleted: true })
    const res = await deleteThreadAction("t1", { alsoDeleteMemories: true })
    expect(res.success).toBe(true)
    if (res.success) expect(res.memoriesDeleted).toBe(4)
    // Ordering invariant: memories deleted BEFORE the thread.
    expect(chatMock.deleteMemoriesSourcedFromThread).toHaveBeenCalledBefore(chatMock.deleteThread)
    expect(chatMock.deleteMemoriesSourcedFromThread).toHaveBeenCalledWith("t1")
    expect(chatMock.deleteThread).toHaveBeenCalledWith("t1")
  })

  it("refuses a non-chat / unknown thread with success:false and deletes nothing", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.getChatThread.mockResolvedValue(null)
    const res = await deleteThreadAction("c1", { alsoDeleteMemories: false })
    expect(res.success).toBe(false)
    expect(chatMock.deleteMemoriesSourcedFromThread).not.toHaveBeenCalled()
    expect(chatMock.deleteThread).not.toHaveBeenCalled()
  })

  it("returns failure if requireAdmin throws", async () => {
    authMock.requireAdmin.mockRejectedValue(new Error("not admin"))
    const res = await deleteThreadAction("t1", { alsoDeleteMemories: false })
    expect(res.success).toBe(false)
    expect(chatMock.getChatThread).not.toHaveBeenCalled()
  })

  it("returns failure if deleteThread throws", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.getChatThread.mockResolvedValue({ id: "t1", purpose: "chat" })
    chatMock.deleteThread.mockRejectedValue(new Error("rls denied"))
    const res = await deleteThreadAction("t1", { alsoDeleteMemories: false })
    expect(res.success).toBe(false)
  })
})
