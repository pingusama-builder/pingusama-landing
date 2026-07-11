import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.hoisted(() => ({ getCurrentUser: vi.fn(), isAdmin: vi.fn() }))
const chatMock = vi.hoisted(() => ({
  getCompanionThread: vi.fn(),
  getOrCreateCompanionThread: vi.fn(),
  appendMessage: vi.fn(),
  getMessages: vi.fn(),
  recallMemories: vi.fn(),
  consumeOneTurnOverride: vi.fn(),
  saveMemory: vi.fn(),
  setThreadModelPreference: vi.fn(),
  setOneTurnOverride: vi.fn(),
}))
const writingContextMock = vi.hoisted(() => ({ buildWritingContext: vi.fn() }))
const mistralMock = vi.hoisted(() => ({ mistralStream: vi.fn(), mistralTurn: vi.fn() }))

vi.mock("@/lib/auth", () => ({ getCurrentUser: authMock.getCurrentUser, isAdmin: authMock.isAdmin }))
vi.mock("@/lib/db/chat", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/chat")>("@/lib/db/chat")
  return {
    ...actual,
    getCompanionThread: chatMock.getCompanionThread,
    getOrCreateCompanionThread: chatMock.getOrCreateCompanionThread,
    appendMessage: chatMock.appendMessage,
    getMessages: chatMock.getMessages,
    recallMemories: chatMock.recallMemories,
    consumeOneTurnOverride: chatMock.consumeOneTurnOverride,
    saveMemory: chatMock.saveMemory,
    setThreadModelPreference: chatMock.setThreadModelPreference,
    setOneTurnOverride: chatMock.setOneTurnOverride,
  }
})
vi.mock("@/lib/chat/writing-context", () => ({ buildWritingContext: writingContextMock.buildWritingContext }))
vi.mock("@/lib/chat/models", () => ({
  MODEL_TIERS: { small: "mistral-small-latest", medium: "mistral-medium-latest", large: "mistral-large-latest" },
  DEFAULT_TIER: "medium",
}))
vi.mock("@/lib/chat/mistral", () => ({ mistralStream: mistralMock.mistralStream, mistralTurn: mistralMock.mistralTurn }))
// buildCompanionPrompt + companion-tools run REAL (pure prompt build + allowlist dispatch).
// They only reach the mocked @/lib/db/chat for save_writing_preference / set_model.

import { POST } from "@/app/api/blog-companion/route"

const DRAFT = {
  content_markdown: "The opening repeats the title.",
  title: "Draft",
  excerpt: "",
  meta_description: "",
}

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

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/blog-companion", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function threadRow(over: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    title: "Companion: post post-1",
    created_at: "2026-07-11",
    updated_at: "2026-07-11",
    model_preference: null,
    one_turn_override: null,
    purpose: "blog-companion",
    subject_type: "post",
    subject_key: "post-1",
    ...over,
  }
}

function setupOk() {
  authMock.getCurrentUser.mockResolvedValue({ id: "admin-1" })
  authMock.isAdmin.mockReturnValue(true)
  chatMock.getOrCreateCompanionThread.mockResolvedValue(threadRow())
  chatMock.getCompanionThread.mockResolvedValue(threadRow())
  chatMock.consumeOneTurnOverride.mockResolvedValue(null)
  chatMock.appendMessage.mockResolvedValue({
    id: "m1",
    thread_id: "c-1",
    role: "user",
    content: "hi",
    tool_calls: null,
    created_at: "2026-07-11",
  })
  chatMock.getMessages.mockResolvedValue([])
  chatMock.recallMemories.mockResolvedValue([])
  writingContextMock.buildWritingContext.mockResolvedValue("WRITING_CTX")
  mistralMock.mistralStream.mockImplementation(async (opts: any) => {
    opts.onContent?.("Findings: the opening repeats the title.")
    return { role: "assistant", content: "Findings: the opening repeats the title.", tool_calls: [], finish_reason: "stop" }
  })
}

describe("POST /api/blog-companion — admin gate + origin", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not an admin", async () => {
    authMock.getCurrentUser.mockResolvedValue(null)
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT }))
    expect(res.status).toBe(401)
  })

  it("returns 403 for a cross-origin POST", async () => {
    setupOk()
    const res = await POST(
      makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT }, { origin: "https://evil.example" })
    )
    expect(res.status).toBe(403)
    expect(chatMock.getOrCreateCompanionThread).not.toHaveBeenCalled()
  })
})

describe("POST /api/blog-companion — request + size limits", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 400 for an empty message", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "   ", subjectType: "post", subjectKey: "post-1", draft: DRAFT }))
    expect(res.status).toBe(400)
  })

  it("returns 400 for an invalid subjectType", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "review", subjectType: "weird", subjectKey: "k", draft: DRAFT }))
    expect(res.status).toBe(400)
  })

  it("returns 400 for a missing draft", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1" }))
    expect(res.status).toBe(400)
  })

  it("returns 413 for an over-large draft", async () => {
    setupOk()
    const big = { ...DRAFT, content_markdown: "x".repeat(50_001) }
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: big }))
    expect(res.status).toBe(413)
  })
})

describe("POST /api/blog-companion — thread resolution + verification", () => {
  beforeEach(() => vi.clearAllMocks())

  it("first turn: resolves the thread via getOrCreateCompanionThread by subject", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "review this draft", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full" }))
    expect(res.status).toBe(200)
    expect(chatMock.getOrCreateCompanionThread).toHaveBeenCalledWith({ subjectType: "post", subjectKey: "post-1" })
    expect(chatMock.getCompanionThread).not.toHaveBeenCalled()
  })

  it("subsequent turn: verifies the supplied threadId via getCompanionThread", async () => {
    setupOk()
    const res = await POST(makeRequest({ threadId: "c-1", message: "and the next paragraph", subjectType: "post", subjectKey: "post-1", draft: DRAFT }))
    expect(res.status).toBe(200)
    expect(chatMock.getCompanionThread).toHaveBeenCalledWith("c-1", { subjectType: "post", subjectKey: "post-1" })
    expect(chatMock.getOrCreateCompanionThread).not.toHaveBeenCalled()
  })

  it("rejects a threadId whose subject mismatches the request (400)", async () => {
    setupOk()
    chatMock.getCompanionThread.mockResolvedValue(null) // subject mismatch → null
    const res = await POST(makeRequest({ threadId: "c-1", message: "review", subjectType: "post", subjectKey: "post-OTHER", draft: DRAFT }))
    expect(res.status).toBe(400)
    expect(chatMock.appendMessage).not.toHaveBeenCalled()
  })

  it("rejects a purpose='chat' thread id (getCompanionThread null → 400)", async () => {
    setupOk()
    chatMock.getCompanionThread.mockResolvedValue(null)
    const res = await POST(makeRequest({ threadId: "t-chat", message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/blog-companion — scope-based model routing", () => {
  beforeEach(() => vi.clearAllMocks())

  function modelEvt(events: Record<string, unknown>[]) {
    return events.find((e) => e.type === "model")
  }

  it("scope 'full' → large", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "review this draft", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full" }))
    const events = await drainSSE(res)
    expect((modelEvt(events) as any)?.tier).toBe("large")
    expect((modelEvt(events) as any)?.modelId).toBe("mistral-large-latest")
  })

  it("scope 'title' → small", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "suggest titles", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "title" }))
    const events = await drainSSE(res)
    expect((modelEvt(events) as any)?.tier).toBe("small")
  })

  it("scope 'opening' → medium", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "check the opening", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "opening" }))
    const events = await drainSSE(res)
    expect((modelEvt(events) as any)?.tier).toBe("medium")
  })

  it("no scope (free-form) → medium (default)", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "what do you think", subjectType: "post", subjectKey: "post-1", draft: DRAFT }))
    const events = await drainSSE(res)
    expect((modelEvt(events) as any)?.tier).toBe("medium")
  })

  it("pinned preference (non-auto) wins over scope", async () => {
    setupOk()
    chatMock.getOrCreateCompanionThread.mockResolvedValue(threadRow({ model_preference: "small" }))
    const res = await POST(makeRequest({ message: "review this draft", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full" }))
    const events = await drainSSE(res)
    expect((modelEvt(events) as any)?.tier).toBe("small")
  })

  it("one-turn override wins over pinned + scope", async () => {
    setupOk()
    chatMock.getOrCreateCompanionThread.mockResolvedValue(threadRow({ model_preference: "small" }))
    chatMock.consumeOneTurnOverride.mockResolvedValue("large")
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "title" }))
    const events = await drainSSE(res)
    expect((modelEvt(events) as any)?.tier).toBe("large")
  })
})

describe("POST /api/blog-companion — streaming + proposals + allowlist", () => {
  beforeEach(() => vi.clearAllMocks())

  it("streams content + done (no tools)", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full" }))
    const events = await drainSSE(res)
    const types = events.map((e) => e.type)
    expect(types).toContain("thread")
    expect(types).toContain("model")
    expect(types).toContain("content")
    expect(types).toContain("done")
    // Persists the REQUEST only (1 user + 1 assistant = 2 appends; no draft row).
    expect(chatMock.appendMessage).toHaveBeenCalledTimes(2)
    const userAppend = chatMock.appendMessage.mock.calls.find((c) => c[0].role === "user")
    expect(userAppend?.[0].content).toBe("review [scope: full]")
  })

  it("emits a proposal event for a valid propose_edit, with baseRevision + range", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("Findings: repetition.")
      return {
        role: "assistant",
        content: "Findings: repetition.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "propose_edit",
              arguments: JSON.stringify({
                field: "body",
                original: "The opening repeats the title.",
                replacement: "The opening restates the premise.",
                rationale: "Diagnosis: repeats. Basis: SW1. Tradeoff: none.",
                principleId: "SW1",
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      }
    })
    // Second turn: model answers.
    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        opts.onContent?.("Findings: repetition.")
        return {
          role: "assistant",
          content: "Findings: repetition.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "propose_edit",
                arguments: JSON.stringify({
                  field: "body",
                  original: "The opening repeats the title.",
                  replacement: "The opening restates the premise.",
                  rationale: "Diagnosis: repeats. Basis: SW1. Tradeoff: none.",
                  principleId: "SW1",
                }),
              },
            },
          ],
          finish_reason: "tool_calls",
        }
      }
      opts.onContent?.("Done.")
      return { role: "assistant", content: "Done.", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full" }))
    const events = await drainSSE(res)
    const proposal = events.find((e) => e.type === "proposal")
    expect(proposal).toBeDefined()
    expect((proposal as any).field).toBe("body")
    expect((proposal as any).original).toBe("The opening repeats the title.")
    expect((proposal as any).range.start).toBe(0)
    expect((proposal as any).baseRevision).toMatch(/^[0-9a-f]{16}$/)
    expect((proposal as any).principleId).toBe("SW1")
  })

  it("an unadvertised tool (read_code) is refused by the allowlist (no proposal)", async () => {
    setupOk()
    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        return {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "x",
              type: "function",
              function: { name: "read_code", arguments: JSON.stringify({ feature: "blog" }) },
            },
          ],
          finish_reason: "tool_calls",
        }
      }
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT }))
    const events = await drainSSE(res)
    const toolEvents = events.filter((e) => e.type === "tool")
    expect(toolEvents.some((e) => (e as any).result?.match(/Tool unavailable in writing companion/))).toBe(true)
    expect(events.some((e) => e.type === "proposal")).toBe(false)
  })
})

describe("POST /api/blog-companion — failure handling (partial-aware)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("emits error with partial:true when content already streamed", async () => {
    setupOk()
    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        opts.onContent?.("Partial findings…")
        throw new Error("upstream blew up")
      }
      return { role: "assistant", content: "", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT }))
    const events = await drainSSE(res)
    const err = events.find((e) => e.type === "error")
    expect(err).toBeDefined()
    expect((err as any).partial).toBe(true)
    expect((err as any).message).toMatch(/upstream blew up/)
  })

  it("emits error with partial:false when nothing streamed yet", async () => {
    setupOk()
    mistralMock.mistralStream.mockRejectedValue(new Error("mistral down"))
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT }))
    const events = await drainSSE(res)
    const err = events.find((e) => e.type === "error")
    expect((err as any).partial).toBe(false)
  })
})

describe("POST /api/blog-companion — review mode (advisor §B)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("accepts reviewMode 'fiction' (200) and persists a [mode: fiction] note", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "review this story", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full", reviewMode: "fiction" }))
    expect(res.status).toBe(200)
    const events = await drainSSE(res)
    expect(events.some((e) => e.type === "done")).toBe(true)
    const userAppend = chatMock.appendMessage.mock.calls.find((c) => c[0].role === "user")
    expect(userAppend?.[0].content).toBe("review this story [scope: full] [mode: fiction]")
  })

  it("rejects an invalid reviewMode (400)", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, reviewMode: "screenplay" }))
    expect(res.status).toBe(400)
  })

  it("auto mode omits the [mode:] note (no mode stored for the default)", async () => {
    setupOk()
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full", reviewMode: "auto" }))
    expect(res.status).toBe(200)
    await drainSSE(res)
    const userAppend = chatMock.appendMessage.mock.calls.find((c) => c[0].role === "user")
    expect(userAppend?.[0].content).toBe("review [scope: full]")
  })
})