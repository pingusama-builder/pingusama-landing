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
  })
  chatMock.getThread.mockResolvedValue(null)
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