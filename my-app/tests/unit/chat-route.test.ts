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
  reasoningEffortForModel: vi.fn(),
}))
const tavilyMock = vi.hoisted(() => ({
  searchWeb: vi.fn(),
  formatWebEvidence: vi.fn(),
  formatWebEvidenceGuarded: vi.fn(),
  subjectInSources: vi.fn(),
  mergeWebResearch: vi.fn(),
  rankSources: vi.fn(),
  extractPages: vi.fn(),
}))
const rewriteMock = vi.hoisted(() => ({
  rewriteSearchQueries: vi.fn(),
}))
const webTriggerMock = vi.hoisted(() => ({
  decideWebEnabled: vi.fn(),
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
  reasoningEffortForModel: mistralMock.reasoningEffortForModel,
}))
vi.mock("@/lib/chat/tavily-search", () => ({
  searchWeb: tavilyMock.searchWeb,
  formatWebEvidence: tavilyMock.formatWebEvidence,
  formatWebEvidenceGuarded: tavilyMock.formatWebEvidenceGuarded,
  subjectInSources: tavilyMock.subjectInSources,
  mergeWebResearch: tavilyMock.mergeWebResearch,
  rankSources: tavilyMock.rankSources,
  extractPages: tavilyMock.extractPages,
}))
vi.mock("@/lib/chat/query-rewrite", () => ({
  rewriteSearchQueries: rewriteMock.rewriteSearchQueries,
}))
vi.mock("@/lib/chat/web-trigger", () => ({
  decideWebEnabled: webTriggerMock.decideWebEnabled,
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
  tavilyMock.searchWeb.mockResolvedValue({ provider: "tavily", query: "", searchedAt: new Date().toISOString(), sources: [] })
  tavilyMock.formatWebEvidence.mockReturnValue("")
  tavilyMock.formatWebEvidenceGuarded.mockReturnValue("")
  tavilyMock.subjectInSources.mockReturnValue(true)
  // Pipeline defaults: merge returns the first study; rank is passthrough;
  // extract returns no pages (snippets-only); reasoning substrate inactive.
  tavilyMock.mergeWebResearch.mockImplementation((studies: any[]) =>
    studies[0] ?? { provider: "tavily", query: "", searchedAt: "", sources: [] }
  )
  tavilyMock.rankSources.mockImplementation((srcs: any[]) => srcs)
  tavilyMock.extractPages.mockResolvedValue({ pages: [], failed: [] })
  mistralMock.reasoningEffortForModel.mockReturnValue(undefined) // non-reasoning by default
  // Default passthrough: rewrite returns [raw message], no subject. Existing
  // tests assert searchWeb receives the raw message; this preserves that.
  rewriteMock.rewriteSearchQueries.mockImplementation(async (msg: string) => ({ queries: [msg], subject: null }))
  // Default: the needs-web? classifier says no-search (auto path). Tests that
  // want web on the auto path override this; tests using webMode:"on" or the
  // /web prefix bypass the classifier entirely.
  webTriggerMock.decideWebEnabled.mockResolvedValue({ webEnabled: false, decision: "no-search", via: "heuristic" })
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

  it("pinned 'large' selects the large tier + mistral-large-latest (Q2 case 6: routing code path is correct)", async () => {
    // The two live debug logs showed thread.model_preference:"large" but turn 1
    // response_model mistral-small-latest. Investigation: those threads were
    // created fresh (turn 1 = the title message), so turn 1 ran on auto (new
    // threads have model_preference null -> "auto") and the auto-router picked
    // small for a short factual question; the user pinned "large" on a LATER
    // turn. The debug-log export reads the CURRENT model_preference via
    // getThread, not the per-turn value — so the header shows "large" while
    // turn 1's per-row model correctly shows small. That is a read-time
    // artifact, NOT a routing bug. This test confirms the pinned-large routing
    // path itself selects the expected tier (so the mismatch is not a routing
    // defect).
    setupOk()
    chatMock.getThread.mockResolvedValue({
      id: "t-new",
      title: "Hi",
      created_at: "2026-07-11",
      updated_at: "2026-07-11",
      model_preference: "large",
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
    const modelEvt = events.find((e) => e.type === "model") as any
    expect(modelEvt.tier).toBe("large")
    expect(modelEvt.modelId).toBe("mistral-large-latest")
    expect(modelsMock.classifyDifficultyHybrid).not.toHaveBeenCalled()
    const assistantAppend = chatMock.appendMessage.mock.calls.find(
      (c) => c[0].role === "assistant"
    )
    expect(assistantAppend?.[0].model).toBe("mistral-large-latest")
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

describe("POST /api/chat — Tavily web research", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.TAVILY_API_KEY
  })

  it("does not call Tavily when webEnabled is false and no /web prefix", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "hi" }))
    expect(res.status).toBe(200)
    const events = await drainSSE(res)
    expect(tavilyMock.searchWeb).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === "web_sources")).toBe(false)
    expect(events.some((e) => e.type === "web_status")).toBe(false)
  })

  it("calls Tavily once when webEnabled is true", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily",
      query: "current weather Paris",
      searchedAt: "2026-07-14T12:00:00Z",
      sources: [
        { title: "Weather.com", url: "https://weather.com", domain: "weather.com", snippet: "Paris: 22°C", score: 0.9 },
      ],
    })
    tavilyMock.formatWebEvidence.mockReturnValue("[PUBLIC WEB EVIDENCE]\n1. Weather.com — https://weather.com\n   Snippet: Paris: 22°C")
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue("[PUBLIC WEB EVIDENCE]\n1. Weather.com — https://weather.com\n   Snippet: Paris: 22°C")
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("It's 22°C in Paris.")
      return { role: "assistant", content: "It's 22°C in Paris.", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "current weather Paris", webEnabled: true }))
    expect(res.status).toBe(200)
    const events = await drainSSE(res)

    expect(tavilyMock.searchWeb).toHaveBeenCalledTimes(1)
    expect(tavilyMock.searchWeb).toHaveBeenCalledWith("current weather Paris")
    const ws = events.find((e) => e.type === "web_sources")
    expect(ws).toBeDefined()
    expect((ws as any).sources).toHaveLength(1)
    expect((ws as any).query).toBe("current weather Paris")

    // Evidence is injected into the system prompt sent to Mistral.
    const messages = mistralMock.mistralStream.mock.calls[0][0].messages
    const system = messages.find((m: any) => m.role === "system")
    expect(system?.content).toContain("[PUBLIC WEB EVIDENCE]")
    expect(system?.content).toContain("https://weather.com")
  })

  it("strips /web prefix and enables search", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily",
      query: "Paris weather",
      searchedAt: "2026-07-14T12:00:00Z",
      sources: [],
    })
    tavilyMock.formatWebEvidence.mockReturnValue("")
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "/web Paris weather" }))
    expect(res.status).toBe(200)
    await drainSSE(res)

    expect(tavilyMock.searchWeb).toHaveBeenCalledWith("Paris weather")
    // The stored user message should not contain the /web prefix.
    const userAppend = chatMock.appendMessage.mock.calls.find((c) => c[0].role === "user")
    expect(userAppend?.[0].content).toBe("Paris weather")
  })

  it("emits web_status:unavailable when key is missing", async () => {
    setupOk()
    // TAVILY_API_KEY is deleted in beforeEach
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "hi", webEnabled: true }))
    expect(res.status).toBe(200)
    const events = await drainSSE(res)

    expect(tavilyMock.searchWeb).not.toHaveBeenCalled()
    const status = events.find((e) => e.type === "web_status")
    expect(status).toBeDefined()
    expect((status as any).status).toBe("unavailable")
    expect((status as any).reason).toMatch(/Tavily API key not configured/)
  })

  it("emits web_status:empty when search returns no sources", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily",
      query: "xyz123nonsense",
      searchedAt: "2026-07-14T12:00:00Z",
      sources: [],
    })
    tavilyMock.formatWebEvidence.mockReturnValue("")
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "xyz123nonsense", webEnabled: true }))
    expect(res.status).toBe(200)
    const events = await drainSSE(res)

    const ws = events.find((e) => e.type === "web_sources")
    expect(ws).toBeDefined()
    expect((ws as any).sources).toHaveLength(0)
    const status = events.find((e) => e.type === "web_status")
    expect(status).toBeDefined()
    expect((status as any).status).toBe("empty")
  })

  it("rewrites the query before searching and surfaces the rewritten query + subject", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    rewriteMock.rewriteSearchQueries.mockResolvedValue({ queries: ["Dan Koe AI 2025 2026"], subject: "Dan Koe" })
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily",
      query: "Dan Koe AI 2025 2026",
      searchedAt: "2026-07-14T12:00:00Z",
      sources: [
        { title: "Dan Koe on AI", url: "https://dankoe.com/ai", domain: "dankoe.com", snippet: "Dan Koe writes about AI", score: 0.9 },
      ],
    })
    tavilyMock.subjectInSources.mockReturnValue(true)
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "2025-2026他有講AI內容?", webEnabled: true }))
    expect(res.status).toBe(200)
    const events = await drainSSE(res)

    // Rewrite was called with the raw message and the prior-history rows.
    expect(rewriteMock.rewriteSearchQueries).toHaveBeenCalledTimes(1)
    expect(rewriteMock.rewriteSearchQueries.mock.calls[0][0]).toBe("2025-2026他有講AI內容?")
    // searchWeb received the REWRITTEN query, not the raw pronoun-bearing message.
    expect(tavilyMock.searchWeb).toHaveBeenCalledWith("Dan Koe AI 2025 2026")
    const ws = events.find((e) => e.type === "web_sources")
    expect((ws as any).query).toBe("Dan Koe AI 2025 2026")
    expect((ws as any).subject).toBe("Dan Koe")
    expect((ws as any).subjectMatch).toBe(true)
    // No subject_absent status when the subject is present.
    expect(events.some((e) => e.type === "web_status")).toBe(false)
  })

  it("subject-absent guard: emits subject_absent + injects the guard block, not raw evidence", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    rewriteMock.rewriteSearchQueries.mockResolvedValue({ queries: ["Dan Koe AI 2025 2026"], subject: "Dan Koe" })
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily",
      query: "Dan Koe AI 2025 2026",
      searchedAt: "2026-07-14T12:00:00Z",
      sources: [
        { title: "2026 AI 人才年會", url: "https://junyi.org", domain: "junyi.org", snippet: "簡立峰 talks about 數位分身", score: 0.9 },
      ],
    })
    // No source mentions "Dan Koe".
    tavilyMock.subjectInSources.mockReturnValue(false)
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue(
      "[PUBLIC WEB EVIDENCE — UNTRUSTED REFERENCE MATERIAL]\nThe web search returned sources, but NONE mention \"Dan Koe\".\nDo NOT attribute any claim to \"Dan Koe\"."
    )
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "2025-2026他有講AI內容?", webEnabled: true }))
    expect(res.status).toBe(200)
    const events = await drainSSE(res)

    // The guarded formatter was called with the subject.
    expect(tavilyMock.formatWebEvidenceGuarded).toHaveBeenCalledTimes(1)
    // The guard block is injected into the system prompt, not raw snippets.
    const messages = mistralMock.mistralStream.mock.calls[0][0].messages
    const system = messages.find((m: any) => m.role === "system")
    expect(system?.content).toContain('NONE mention "Dan Koe"')
    expect(system?.content).toContain("Do NOT attribute")
    // web_sources reports subjectMatch false.
    const ws = events.find((e) => e.type === "web_sources")
    expect((ws as any).subjectMatch).toBe(false)
    // subject_absent status surfaced with the subject.
    const status = events.find((e) => e.type === "web_status")
    expect(status).toBeDefined()
    expect((status as any).status).toBe("subject_absent")
    expect((status as any).subject).toBe("Dan Koe")
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

describe("POST /api/chat — web pipeline (depth + breadth)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.TAVILY_API_KEY
  })

  it("runs parallel searches for multiple queries, merges, extracts top sources, emits web_phase + readFull", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    mistralMock.reasoningEffortForModel.mockReturnValue("high")
    rewriteMock.rewriteSearchQueries.mockResolvedValue({
      queries: ["Dan Koe AI 2025", "Dan Koe essays"],
      subject: "Dan Koe",
    })
    tavilyMock.searchWeb.mockImplementation(async (q: string) => ({
      provider: "tavily",
      query: q,
      searchedAt: "x",
      sources: q.includes("essays")
        ? [{ title: "Dan Koe essays", url: "https://dankoe.com/essays", domain: "dankoe.com", snippet: "Dan Koe essay", score: 0.9 }]
        : [{ title: "Dan Koe on AI", url: "https://dankoe.com/ai", domain: "dankoe.com", snippet: "Dan Koe on AI", score: 0.85 }],
    }))
    tavilyMock.mergeWebResearch.mockReturnValue({
      provider: "tavily",
      query: "Dan Koe AI 2025",
      searchedAt: "x",
      sources: [
        { title: "Dan Koe on AI", url: "https://dankoe.com/ai", domain: "dankoe.com", snippet: "Dan Koe on AI", score: 0.85 },
        { title: "Dan Koe essays", url: "https://dankoe.com/essays", domain: "dankoe.com", snippet: "Dan Koe essay", score: 0.9 },
      ],
    })
    tavilyMock.rankSources.mockImplementation((s: any[]) => s)
    tavilyMock.subjectInSources.mockReturnValue(true)
    tavilyMock.extractPages.mockResolvedValue({
      pages: [{ url: "https://dankoe.com/ai", content: "Full essay text." }],
      failed: [],
    })
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue(
      "[PUBLIC WEB EVIDENCE]\nREAD IN FULL:\n— https://dankoe.com/ai\nFull essay text."
    )
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "what has Dan Koe said about AI", webEnabled: true }))
    const events = await drainSSE(res)

    // Two parallel searches (one per expanded query).
    expect(tavilyMock.searchWeb).toHaveBeenCalledTimes(2)
    // /extract ran once on the top URLs.
    expect(tavilyMock.extractPages).toHaveBeenCalledTimes(1)
    // web_phase events fired in order.
    const phases = events.filter((e) => e.type === "web_phase").map((e) => (e as any).phase)
    expect(phases).toEqual(["rewriting", "searching", "reading", "done"])
    // web_sources carries queries + readFull.
    const ws = events.find((e) => e.type === "web_sources") as any
    expect(ws.queries).toEqual(["Dan Koe AI 2025", "Dan Koe essays"])
    const sources = ws.sources as any[]
    const rf = ws.readFull as boolean[]
    expect(rf).toBeDefined()
    expect(rf[sources.findIndex((s) => s.url === "https://dankoe.com/ai")]).toBe(true)
    expect(rf[sources.findIndex((s) => s.url === "https://dankoe.com/essays")]).toBe(false)
    // Evidence injected into the system prompt.
    const system = mistralMock.mistralStream.mock.calls[0][0].messages.find((m: any) => m.role === "system")
    expect(system?.content).toContain("READ IN FULL")
  })

  it("extract failure degrades to snippets-only (no readFull, no extract crash)", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    rewriteMock.rewriteSearchQueries.mockResolvedValue({ queries: ["q"], subject: "Dan Koe" })
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily",
      query: "q",
      searchedAt: "x",
      sources: [{ title: "Dan Koe", url: "https://dankoe.com", domain: "dankoe.com", snippet: "Dan Koe", score: 0.9 }],
    })
    tavilyMock.mergeWebResearch.mockReturnValue({
      provider: "tavily",
      query: "q",
      searchedAt: "x",
      sources: [{ title: "Dan Koe", url: "https://dankoe.com", domain: "dankoe.com", snippet: "Dan Koe", score: 0.9 }],
    })
    tavilyMock.rankSources.mockImplementation((s: any[]) => s)
    tavilyMock.subjectInSources.mockReturnValue(true)
    tavilyMock.extractPages.mockResolvedValue({ pages: [], failed: [{ url: "https://dankoe.com", error: "500" }] })
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue("[PUBLIC WEB EVIDENCE]\n1. Dan Koe — https://dankoe.com\n   Snippet: Dan Koe")
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "q", webEnabled: true }))
    const events = await drainSSE(res)
    const ws = events.find((e) => e.type === "web_sources") as any
    expect((ws.readFull as boolean[]).every((x) => x === false)).toBe(true)
    expect(events.some((e) => e.type === "error")).toBe(false)
  })
})

describe("POST /api/chat — web synthesis tier + effort + budget", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.TAVILY_API_KEY
  })

  it("forces the large tier on web turns, sends high effort + 8000 budget + a deadline signal", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    mistralMock.reasoningEffortForModel.mockReturnValue("high") // reasoning-capable large tier
    rewriteMock.rewriteSearchQueries.mockResolvedValue({ queries: ["q"], subject: "Dan Koe" })
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily",
      query: "q",
      searchedAt: "x",
      sources: [{ title: "Dan Koe", url: "https://dankoe.com", domain: "dankoe.com", snippet: "Dan Koe", score: 0.9 }],
    })
    tavilyMock.mergeWebResearch.mockImplementation((s: any[]) => s[0])
    tavilyMock.rankSources.mockImplementation((s: any[]) => s)
    tavilyMock.subjectInSources.mockReturnValue(true)
    tavilyMock.extractPages.mockResolvedValue({ pages: [{ url: "https://dankoe.com", content: "full" }], failed: [] })
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue("[EVIDENCE]")
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "q", webEnabled: true }))
    const events = await drainSSE(res)
    const modelEvt = events.find((e) => e.type === "model") as any
    expect(modelEvt.tier).toBe("large")
    expect(modelEvt.reason).toMatch(/web → large/)
    const callOpts = mistralMock.mistralStream.mock.calls[0][0]
    expect(callOpts.maxTokens).toBe(8000) // full pages → high budget
    expect(callOpts.reasoningEffort).toBe("high")
    expect(callOpts.signal).toBeDefined() // 55s deadline AbortSignal propagated
  })

  it("snippets-only → medium effort + 4000; empty/guard → low + 1500", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    mistralMock.reasoningEffortForModel.mockReturnValue("high")
    rewriteMock.rewriteSearchQueries.mockResolvedValue({ queries: ["q"], subject: "Dan Koe" })
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily",
      query: "q",
      searchedAt: "x",
      sources: [{ title: "Dan Koe", url: "https://dankoe.com", domain: "dankoe.com", snippet: "Dan Koe", score: 0.9 }],
    })
    tavilyMock.mergeWebResearch.mockImplementation((s: any[]) => s[0])
    tavilyMock.rankSources.mockImplementation((s: any[]) => s)
    tavilyMock.subjectInSources.mockReturnValue(true)
    tavilyMock.extractPages.mockResolvedValue({ pages: [], failed: [] }) // snippets only
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue("[EVIDENCE]")
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })

    let res = await POST(makeRequest({ message: "q", webEnabled: true }))
    await drainSSE(res)
    expect(mistralMock.mistralStream.mock.calls[0][0].maxTokens).toBe(4000)
    expect(mistralMock.mistralStream.mock.calls[0][0].reasoningEffort).toBe("medium")

    // empty/guard → low + 1500
    vi.clearAllMocks()
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    mistralMock.reasoningEffortForModel.mockReturnValue("high")
    rewriteMock.rewriteSearchQueries.mockResolvedValue({ queries: ["q"], subject: "Dan Koe" })
    tavilyMock.searchWeb.mockResolvedValue({ provider: "tavily", query: "q", searchedAt: "x", sources: [] })
    tavilyMock.mergeWebResearch.mockReturnValue({ provider: "tavily", query: "q", searchedAt: "x", sources: [] })
    tavilyMock.subjectInSources.mockReturnValue(false)
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue("[GUARD]")
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })
    res = await POST(makeRequest({ message: "q", webEnabled: true }))
    await drainSSE(res)
    expect(mistralMock.mistralStream.mock.calls[0][0].maxTokens).toBe(1500)
    expect(mistralMock.mistralStream.mock.calls[0][0].reasoningEffort).toBe("low")
  })

  it("base (non-web) chat uses the raised 2000/4000 caps and no reasoning_effort", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "hi" }))
    await drainSSE(res)
    const opts = mistralMock.mistralStream.mock.calls[0][0]
    expect(opts.maxTokens).toBe(2000) // non-final base cap
    expect(opts.reasoningEffort).toBeUndefined()
  })

  it("persists partial assistant content + emits error when the stream throws mid-turn (deadline/abort graceful degradation)", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("partial answer that should survive a mid-stream abort")
      throw new Error("aborted mid-stream")
    })
    const res = await POST(makeRequest({ message: "hi" }))
    const events = await drainSSE(res)
    expect(events.some((e) => e.type === "error")).toBe(true)
    const assistantCalls = chatMock.appendMessage.mock.calls.filter((c: any[]) => c[0]?.role === "assistant")
    expect(
      assistantCalls.some((c: any[]) => c[0]?.content === "partial answer that should survive a mid-stream abort")
    ).toBe(true)
  })
})
describe("POST /api/chat — auto web-trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.TAVILY_API_KEY
  })

  it("runs the classifier on auto (webMode omitted) and searches when it says search", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    webTriggerMock.decideWebEnabled.mockResolvedValue({ webEnabled: true, decision: "search", via: "heuristic" })
    rewriteMock.rewriteSearchQueries.mockResolvedValue({ queries: ["Dan Koe AI"], subject: "Dan Koe" })
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily",
      query: "Dan Koe AI",
      searchedAt: "x",
      sources: [{ title: "T", url: "https://e.com", domain: "e.com", snippet: "Dan Koe AI", score: 0.9 }],
    })
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue("[EVIDENCE]")
    tavilyMock.subjectInSources.mockReturnValue(true)
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("answer")
      return { role: "assistant", content: "answer", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "what has Dan Koe said about AI in 2025?" }))
    const events = await drainSSE(res)
    expect(webTriggerMock.decideWebEnabled).toHaveBeenCalledTimes(1)
    expect(tavilyMock.searchWeb).toHaveBeenCalled()
    expect(events.some((e) => e.type === "done")).toBe(true)
  })

  it("does not search when the classifier says no-search", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    webTriggerMock.decideWebEnabled.mockResolvedValue({ webEnabled: false, decision: "no-search", via: "heuristic" })
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("hi!")
      return { role: "assistant", content: "hi!", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "hi" }))
    await drainSSE(res)
    expect(webTriggerMock.decideWebEnabled).toHaveBeenCalledTimes(1)
    expect(tavilyMock.searchWeb).not.toHaveBeenCalled()
  })

  it("/noweb forces off even on a fresh-factual message", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    webTriggerMock.decideWebEnabled.mockResolvedValue({ webEnabled: true, decision: "search", via: "heuristic" })
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "/noweb what has Dan Koe said about AI in 2025?" }))
    await drainSSE(res)
    // /noweb forces off → classifier must not run, no search.
    expect(webTriggerMock.decideWebEnabled).not.toHaveBeenCalled()
    expect(tavilyMock.searchWeb).not.toHaveBeenCalled()
    // Stored user message has the /noweb prefix stripped.
    const userAppend = chatMock.appendMessage.mock.calls.find((c) => c[0].role === "user")
    expect(userAppend?.[0].content).toBe("what has Dan Koe said about AI in 2025?")
  })

  it("webMode:on forces search without the classifier", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    webTriggerMock.decideWebEnabled.mockResolvedValue({ webEnabled: true, decision: "search", via: "heuristic" })
    rewriteMock.rewriteSearchQueries.mockResolvedValue({ queries: ["q"], subject: null })
    tavilyMock.searchWeb.mockResolvedValue({ provider: "tavily", query: "q", searchedAt: "x", sources: [] })
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue("")
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("a")
      return { role: "assistant", content: "a", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "q", webMode: "on" }))
    await drainSSE(res)
    expect(webTriggerMock.decideWebEnabled).not.toHaveBeenCalled()
    expect(tavilyMock.searchWeb).toHaveBeenCalled()
  })

  it("webMode:off skips search even when the classifier would say search", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    webTriggerMock.decideWebEnabled.mockResolvedValue({ webEnabled: true, decision: "search", via: "heuristic" })
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("a")
      return { role: "assistant", content: "a", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "what has Dan Koe said about AI in 2025?", webMode: "off" }))
    await drainSSE(res)
    expect(webTriggerMock.decideWebEnabled).not.toHaveBeenCalled()
    expect(tavilyMock.searchWeb).not.toHaveBeenCalled()
  })
})

describe("POST /api/chat — debug-log capture (reasoning + telemetry)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("captures the reasoning trace + telemetry into the assistant appendMessage and never streams reasoning", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("Answer.")
      opts.onReasoning?.("Let me think. ")
      opts.onReasoning?.("Therefore…")
      return {
        role: "assistant",
        content: "Answer.",
        tool_calls: [],
        finish_reason: "stop",
        response_model: "mistral-medium-3-5",
        reasoning_effort_sent: "high",
        content_chunk_types: ["thinking", "text"],
        reasoning_chars: 22,
        text_chars: 7,
      }
    })
    const res = await POST(makeRequest({ message: "hi" }))
    const events = await drainSSE(res)

    // Reasoning never appears in any SSE event.
    expect(events.some((e) => "reasoning" in e)).toBe(false)
    const contentDeltas = events
      .filter((e) => e.type === "content")
      .map((e) => e.delta)
      .join("")
    expect(contentDeltas).toBe("Answer.")
    expect(contentDeltas).not.toContain("Let me think")

    // The assistant appendMessage carries the accumulated reasoning + telemetry.
    const assistantAppend = chatMock.appendMessage.mock.calls.find(
      (c) => c[0].role === "assistant"
    )
    expect(assistantAppend?.[0].reasoning).toBe("Let me think. Therefore…")
    expect(assistantAppend?.[0].telemetry).toMatchObject({
      response_model: "mistral-medium-3-5",
      reasoning_effort_sent: "high",
      reasoning_chars: 22,
      finish_reason: "stop",
    })
  })

  it("persists null reasoning on non-reasoning turns (no onReasoning fired)", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return {
        role: "assistant",
        content: "ok",
        tool_calls: [],
        finish_reason: "stop",
        response_model: "mistral-medium-latest",
      }
    })
    const res = await POST(makeRequest({ message: "hi" }))
    await drainSSE(res)
    const assistantAppend = chatMock.appendMessage.mock.calls.find(
      (c) => c[0].role === "assistant"
    )
    expect(assistantAppend?.[0].reasoning).toBeNull()
    expect(assistantAppend?.[0].telemetry).toMatchObject({
      response_model: "mistral-medium-latest",
      finish_reason: "stop",
    })
  })
})

describe("POST /api/chat — web-research audit capture (Q1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.TAVILY_API_KEY
  })

  it("captures a pipeline run on the assistant row of a web turn; user rows get none", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    rewriteMock.rewriteSearchQueries.mockResolvedValue({ queries: ["Dan Koe AI 2025"], subject: "Dan Koe" })
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily", query: "Dan Koe AI 2025", searchedAt: "x",
      sources: [{ title: "Dan Koe on AI", url: "https://dankoe.com/ai", domain: "dankoe.com", snippet: "Dan Koe on AI", score: 0.9 }],
    })
    tavilyMock.mergeWebResearch.mockImplementation((s: any[]) => s[0])
    tavilyMock.rankSources.mockImplementation((s: any[]) => s)
    tavilyMock.subjectInSources.mockReturnValue(true)
    tavilyMock.extractPages.mockResolvedValue({ pages: [], failed: [] })
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue("[EVIDENCE]")
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("answer")
      return { role: "assistant", content: "answer", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "what has Dan Koe said about AI in 2025?", webEnabled: true }))
    await drainSSE(res)

    const assistantAppend = chatMock.appendMessage.mock.calls.find((c: any[]) => c[0]?.role === "assistant")
    const audit = assistantAppend?.[0].webResearch
    expect(audit).not.toBeNull()
    expect(audit.schemaVersion).toBe(1)
    expect(audit.availableToAssistantMessage).toBe(true)
    expect(audit.runs).toHaveLength(1)
    expect(audit.runs[0].via).toBe("pipeline")
    expect(audit.runs[0].mode).toBe("on") // webEnabled:true → webMode "on"
    expect(audit.runs[0].queries).toEqual(["Dan Koe AI 2025"])
    expect(audit.runs[0].subject).toBe("Dan Koe")
    expect(audit.runs[0].subjectMatch).toBe(true)
    expect(audit.runs[0].guard).toBe("none")
    expect(audit.runs[0].sources[0].url).toBe("https://dankoe.com/ai")
    expect(audit.runs[0].sources[0].readFull).toBe(false) // no pages extracted
    expect(audit.runs[0].evidenceInjected).toBe("[EVIDENCE]")
    // The user-row appendMessage carries no webResearch.
    const userAppend = chatMock.appendMessage.mock.calls.find((c: any[]) => c[0]?.role === "user")
    expect(userAppend?.[0].webResearch).toBeUndefined()
  })

  it("captures no audit on a non-web assistant row (null webResearch)", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "hi" }))
    await drainSSE(res)
    const assistantAppend = chatMock.appendMessage.mock.calls.find((c: any[]) => c[0]?.role === "assistant")
    expect(assistantAppend?.[0].webResearch).toBeNull()
  })

  it("captures a tool run on the assistant row AFTER a web_search follow-up (capture-by-model-call-visibility)", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    rewriteMock.rewriteSearchQueries.mockResolvedValue({ queries: ["Kimi K3 benchmark"], subject: "Kimi K3" })
    tavilyMock.searchWeb.mockImplementation(async (q: string) => ({
      provider: "tavily", query: q, searchedAt: "x",
      sources: [{ title: "Kimi K3", url: "https://kimi.com", domain: "kimi.com", snippet: "Kimi K3 benchmark", score: 0.9 }],
    }))
    tavilyMock.mergeWebResearch.mockImplementation((s: any[]) => s[0])
    tavilyMock.rankSources.mockImplementation((s: any[]) => s)
    tavilyMock.subjectInSources.mockReturnValue(true)
    tavilyMock.extractPages.mockResolvedValue({ pages: [], failed: [] })
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue("[EVIDENCE]")
    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        return {
          role: "assistant", content: "",
          tool_calls: [{ id: "c1", type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: "Kimi K3 LMSYS", subject: "Kimi K3" }) } }],
          finish_reason: "tool_calls",
        }
      }
      opts.onContent?.("final answer")
      return { role: "assistant", content: "final answer", tool_calls: [], finish_reason: "stop" }
    })

    const res = await POST(makeRequest({ message: "how good is Kimi K3?", webEnabled: true }))
    await drainSSE(res)

    // Two assistant appendMessage calls: the tool-call stub (call 1) and the final answer (call 2).
    const assistantCalls = chatMock.appendMessage.mock.calls.filter((c: any[]) => c[0]?.role === "assistant")
    expect(assistantCalls).toHaveLength(2)
    // First assistant row (tool-call stub) has only the pipeline run — the tool
    // hasn't run yet at that snapshot (capture-by-model-call-visibility).
    const firstAudit = assistantCalls[0][0].webResearch
    expect(firstAudit.runs).toHaveLength(1)
    expect(firstAudit.runs[0].via).toBe("pipeline")
    // Second assistant row (final answer, AFTER the web_search tool result) has pipeline + tool.
    const secondAudit = assistantCalls[1][0].webResearch
    expect(secondAudit.runs).toHaveLength(2)
    expect(secondAudit.runs[0].via).toBe("pipeline")
    expect(secondAudit.runs[1].via).toBe("tool")
    expect(secondAudit.runs[1].mode).toBe("tool")
    expect(secondAudit.runs[1].queries).toEqual(["Kimi K3 LMSYS"])
    expect(secondAudit.runs[1].pages).toEqual([])
    // The tool-row appendMessage carries no webResearch (it's evidence, not a model call).
    const toolRow = chatMock.appendMessage.mock.calls.find((c: any[]) => c[0]?.role === "tool")
    expect(toolRow?.[0].webResearch).toBeUndefined()
  })
})
