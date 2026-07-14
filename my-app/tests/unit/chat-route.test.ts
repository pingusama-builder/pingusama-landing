import { describe, it, expect, vi, beforeEach } from "vitest"

// Fully stub the route's dependencies so the SSE agent loop runs deterministically
// without touching Supabase, Mistral, or cookies. The real executeToolCall runs
// (from @/lib/chat/tools) but its DB writes hit the mocked @/lib/db/chat.
const authMock = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  isAdmin: vi.fn(),
}))
const chatMock = vi.hoisted(() => ({
  createThread: vi.fn(),
  getThread: vi.fn(),
  appendMessage: vi.fn(),
  getMessages: vi.fn(),
  recallMemories: vi.fn(),
  saveMemory: vi.fn(),
  consumeOneTurnOverride: vi.fn(),
}))
const modelsMock = vi.hoisted(() => ({
  classifyDifficultyHybrid: vi.fn(),
  resolveModel: vi.fn(),
}))
vi.mock("@/lib/chat/models", () => ({
  classifyDifficultyHybrid: modelsMock.classifyDifficultyHybrid,
  resolveModel: modelsMock.resolveModel,
  MODEL_TIERS: { small: "mistral-small-latest", medium: "mistral-medium-latest", large: "mistral-large-latest" },
  DEFAULT_TIER: "medium",
  bandToTier: (b: string) => (b === "easy" ? "small" : b === "hard" ? "large" : "medium"),
  MODEL_PREFERENCES: ["auto", "small", "medium", "large"],
}))
const awarenessMock = vi.hoisted(() => ({
  buildSiteContext: vi.fn(),
}))
const mistralMock = vi.hoisted(() => ({
  mistralStream: vi.fn(),
  mistralTurn: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  getCurrentUser: authMock.getCurrentUser,
  isAdmin: authMock.isAdmin,
}))
vi.mock("@/lib/db/chat", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/chat")>("@/lib/db/chat")
  return {
    ...actual,
    createThread: chatMock.createThread,
    getThread: chatMock.getThread,
    appendMessage: chatMock.appendMessage,
    getMessages: chatMock.getMessages,
    recallMemories: chatMock.recallMemories,
    saveMemory: chatMock.saveMemory,
    consumeOneTurnOverride: chatMock.consumeOneTurnOverride,
  }
})
vi.mock("@/lib/chat/awareness", () => ({
  buildSiteContext: awarenessMock.buildSiteContext,
  refreshAwareness: vi.fn(),
  readCode: vi.fn(),
}))
vi.mock("@/lib/chat/mistral", () => ({
  mistralStream: mistralMock.mistralStream,
  mistralTurn: mistralMock.mistralTurn,
}))

import { POST } from "@/app/api/chat/route"

async function drainSSE(response: Response): Promise<Record<string, unknown>[]> {
  expect(response.body).toBeTruthy()
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  const events: Record<string, unknown>[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      for (const line of chunk.split("\n")) {
        const t = line.trim()
        if (!t.startsWith("data:")) continue
        try {
          events.push(JSON.parse(t.slice(5).trim()))
        } catch {
          /* ignore keepalives */
        }
      }
    }
  }
  return events
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function setupOk() {
  authMock.getCurrentUser.mockResolvedValue({ id: "admin-1" })
  authMock.isAdmin.mockReturnValue(true)
  chatMock.createThread.mockResolvedValue({
    id: "t-new",
    title: "Hi",
    created_at: "2026-07-11",
    updated_at: "2026-07-11",
    model_preference: null,
    one_turn_override: null,
    purpose: "chat",
    subject_type: null,
    subject_key: null,
  })
  chatMock.getThread.mockResolvedValue({
    id: "t-new",
    title: "Hi",
    created_at: "2026-07-11",
    updated_at: "2026-07-11",
    model_preference: null,
    one_turn_override: null,
    purpose: "chat",
    subject_type: null,
    subject_key: null,
  })
  chatMock.consumeOneTurnOverride.mockResolvedValue(null)
  chatMock.appendMessage.mockResolvedValue({
    id: "m1",
    thread_id: "t-new",
    role: "user",
    content: "hi",
    tool_calls: null,
    created_at: "2026-07-11",
  })
  chatMock.getMessages.mockResolvedValue([])
  chatMock.recallMemories.mockResolvedValue([])
  awarenessMock.buildSiteContext.mockResolvedValue("SITE_CTX")
  modelsMock.classifyDifficultyHybrid.mockResolvedValue({ band: "easy", via: "heuristic" })
}

describe("POST /api/chat — admin gate", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not an admin", async () => {
    authMock.getCurrentUser.mockResolvedValue(null)
    const res = await POST(makeRequest({ message: "hi" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 for an empty message", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "   " }))
    expect(res.status).toBe(400)
  })

  it("returns 413 for an over-long message", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "x".repeat(4001) }))
    expect(res.status).toBe(413)
  })
})

describe("POST /api/chat — streaming happy path", () => {
  beforeEach(() => vi.clearAllMocks())

  it("streams content + done when no tools are called", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      // Emit the content chunk via the onContent callback, then resolve.
      opts.onContent?.("Hello there.")
      return { role: "assistant", content: "Hello there.", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "hi" }))
    expect(res.headers.get("Content-Type")).toContain("text/event-stream")
    const events = await drainSSE(res)

    const types = events.map((e) => e.type)
    expect(types).toContain("thread")
    expect(types).toContain("content")
    expect(types).toContain("done")
    const content = events
      .filter((e) => e.type === "content")
      .map((e) => e.delta)
      .join("")
    expect(content).toBe("Hello there.")
    // User message + assistant message persisted.
    expect(chatMock.appendMessage).toHaveBeenCalledTimes(2)
  })

  it("runs a tool call, feeds the result back, then answers", async () => {
    setupOk()
    chatMock.saveMemory.mockResolvedValue({
      id: "r1",
      type: "user",
      name: "prefers-terracotta",
      description: "d",
      content: "c",
      links: [],
      source_thread_id: "t-new",
      fingerprint: null,
      last_used_at: "2026-07-11",
      last_synced_at: null,
      created_at: "2026-07-11",
      updated_at: "2026-07-11",
      active: true,
    })

    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        // First turn: the model emits a save_memory tool call, no content.
        return {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "save_memory",
                arguments: JSON.stringify({
                  type: "user",
                  name: "prefers-terracotta",
                  description: "likes warm terracotta accents",
                  content: "Prefers terracotta accents.",
                }),
              },
            },
          ],
          finish_reason: "tool_calls",
        }
      }
      // Second turn: the model answers with content.
      opts.onContent?.("Saved your preference.")
      return { role: "assistant", content: "Saved your preference.", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "remember I like terracotta" }))
    const events = await drainSSE(res)
    const types = events.map((e) => e.type)

    // Tool running + tool done events for save_memory.
    const toolEvents = events.filter((e) => e.type === "tool")
    expect(toolEvents).toHaveLength(2)
    expect(toolEvents[0]).toMatchObject({ name: "save_memory", status: "running" })
    expect(toolEvents[1]).toMatchObject({ name: "save_memory", status: "done" })
    expect(toolEvents[1].result).toMatch(/Saved memory/)

    expect(types[types.length - 1]).toBe("done")
    // The bot's tool call routed to the (mocked) saveMemory — never to site writes.
    expect(chatMock.saveMemory).toHaveBeenCalledTimes(1)
    // assistant(tool-call) + tool(result) + assistant(answer) = 3 assistant/tool rows
    // plus the initial user row = 4 appendMessage calls.
    expect(chatMock.appendMessage).toHaveBeenCalledTimes(4)
  })
})

describe("POST /api/chat — model resolution", () => {
  beforeEach(() => vi.clearAllMocks())

  it("emits a 'model' SSE event and persists the model on the assistant row", async () => {
    setupOk()
    modelsMock.classifyDifficultyHybrid.mockResolvedValue({ band: "hard", via: "heuristic" })
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("Answer.")
      return { role: "assistant", content: "Answer.", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "explain and prove this hard thing" }))
    const events = await drainSSE(res)
    const modelEvt = events.find((e) => e.type === "model")
    expect(modelEvt).toBeDefined()
    expect((modelEvt as any).tier).toBe("large") // hard → large
    expect((modelEvt as any).modelId).toBe("mistral-large-latest")
    // The assistant appendMessage carried the model.
    const assistantAppend = chatMock.appendMessage.mock.calls.find(
      (c) => c[0].role === "assistant"
    )
    expect(assistantAppend?.[0].model).toBe("mistral-large-latest")
  })

  it("auto path calls classifyDifficultyHybrid", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "hi" }))
    await drainSSE(res)
    expect(modelsMock.classifyDifficultyHybrid).toHaveBeenCalledTimes(1)
  })

  it("pinned preference skips the classifier", async () => {
    setupOk()
    chatMock.getThread.mockResolvedValue({
      id: "t-new",
      title: "Hi",
      created_at: "2026-07-11",
      updated_at: "2026-07-11",
      model_preference: "small",
      one_turn_override: null,
      purpose: "chat",
      subject_type: null,
      subject_key: null,
    })
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ threadId: "t-new", message: "hi" }))
    const events = await drainSSE(res)
    const modelEvt = events.find((e) => e.type === "model")
    expect((modelEvt as any).tier).toBe("small")
    expect(modelsMock.classifyDifficultyHybrid).not.toHaveBeenCalled()
  })

  it("consumes a one_turn_override (uses it, then clears it)", async () => {
    setupOk()
    chatMock.getThread.mockResolvedValue({
      id: "t-new",
      title: "Hi",
      created_at: "2026-07-11",
      updated_at: "2026-07-11",
      model_preference: "auto",
      one_turn_override: null,
      purpose: "chat",
      subject_type: null,
      subject_key: null,
    })
    chatMock.consumeOneTurnOverride.mockResolvedValue("large")
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ threadId: "t-new", message: "hi" }))
    const events = await drainSSE(res)
    const modelEvt = events.find((e) => e.type === "model")
    expect((modelEvt as any).tier).toBe("large")
    expect(modelsMock.classifyDifficultyHybrid).not.toHaveBeenCalled()
    expect(chatMock.consumeOneTurnOverride).toHaveBeenCalledWith("t-new")
  })
})

describe("POST /api/chat — message history hygiene", () => {
  beforeEach(() => vi.clearAllMocks())

  it("drops degenerate assistant rows (no content + no tool_calls) from history sent to Mistral", async () => {
    setupOk()
    chatMock.getMessages.mockResolvedValue([
      {
        id: "m1",
        thread_id: "t-new",
        role: "user",
        content: "previous turn",
        tool_calls: null,
        created_at: "2026-07-11",
      },
      {
        id: "m2",
        thread_id: "t-new",
        role: "assistant",
        content: null,
        tool_calls: null,
        created_at: "2026-07-11",
      },
      {
        id: "m3",
        thread_id: "t-new",
        role: "user",
        content: "hi",
        tool_calls: null,
        created_at: "2026-07-11",
      },
    ])
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("Hello there.")
      return { role: "assistant", content: "Hello there.", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "hi" }))
    expect(res.status).toBe(200)
    await drainSSE(res)

    const messages = mistralMock.mistralStream.mock.calls[0][0].messages
    const assistantMessages = messages.filter((m: any) => m.role === "assistant")
    expect(assistantMessages).toHaveLength(0)
    // The valid user messages remain, plus system + the current user message.
    expect(messages.some((m: any) => m.role === "user" && m.content === "previous turn")).toBe(true)
    expect(messages.some((m: any) => m.role === "user" && m.content === "hi")).toBe(true)
  })

  it("keeps assistant rows that have tool_calls even when content is empty/null", async () => {
    setupOk()
    chatMock.getMessages.mockResolvedValue([
      {
        id: "m1",
        thread_id: "t-new",
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "save_memory", arguments: "{}" } }],
        created_at: "2026-07-11",
      },
      {
        id: "m2",
        thread_id: "t-new",
        role: "user",
        content: "hi",
        tool_calls: null,
        created_at: "2026-07-11",
      },
    ])
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("Hello there.")
      return { role: "assistant", content: "Hello there.", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "hi" }))
    expect(res.status).toBe(200)
    await drainSSE(res)

    const messages = mistralMock.mistralStream.mock.calls[0][0].messages
    const assistantMessages = messages.filter((m: any) => m.role === "assistant")
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0].tool_calls).toHaveLength(1)
  })
})

describe("POST /api/chat — companion-thread rejection", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects a purpose='blog-companion' thread id with 400 and does not append", async () => {
    authMock.getCurrentUser.mockResolvedValue({ id: "admin-1" })
    authMock.isAdmin.mockReturnValue(true)
    chatMock.getThread.mockResolvedValue({
      id: "c1",
      title: "Companion: post post-1",
      created_at: "2026-07-11",
      updated_at: "2026-07-11",
      model_preference: null,
      one_turn_override: null,
      purpose: "blog-companion",
      subject_type: "post",
      subject_key: "post-1",
    })
    const res = await POST(makeRequest({ threadId: "c1", message: "hi" }))
    expect(res.status).toBe(400)
    expect(chatMock.appendMessage).not.toHaveBeenCalled()
    expect(chatMock.createThread).not.toHaveBeenCalled()
  })

  it("still creates a new chat thread when threadId is absent (first turn)", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "hi" }))
    expect(res.status).toBe(200)
    expect(chatMock.createThread).toHaveBeenCalledTimes(1)
  })
})