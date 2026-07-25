import { describe, it, expect, vi, beforeEach } from "vitest"

// Interface-level contract tests for runChatTurn. These pin the round-7
// invariants (pause-before-synthesize, idempotent resume, stay-gates-web_search,
// capture-by-model-call-visibility) directly through the module's typed
// interface — the things that were previously only enforced by call-ordering
// across route.ts + tools.ts and thus untestable. The route-level tests
// (chat-route.test.ts) remain the integration net proving the route still
// translates TurnResult/TurnEvent to correct HTTP/SSE.

const chatMock = vi.hoisted(() => ({
  createThread: vi.fn(),
  getThread: vi.fn(),
  appendMessage: vi.fn(),
  getMessages: vi.fn(),
  recallMemories: vi.fn(),
  saveMemory: vi.fn(),
  consumeOneTurnOverride: vi.fn(),
  insertPendingChoice: vi.fn(),
  loadPendingChoice: vi.fn(),
  resolvePendingChoice: vi.fn(),
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
const awarenessMock = vi.hoisted(() => ({ buildSiteContext: vi.fn() }))
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
const rewriteMock = vi.hoisted(() => ({ rewriteSearchQueries: vi.fn() }))
const webTriggerMock = vi.hoisted(() => ({ detectExternalVerificationNeed: vi.fn() }))
const postReadMock = vi.hoisted(() => ({
  detectPostReviewIntent: vi.fn(),
  loadNewestPostForPrompt: vi.fn(),
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
    insertPendingChoice: chatMock.insertPendingChoice,
    loadPendingChoice: chatMock.loadPendingChoice,
    resolvePendingChoice: chatMock.resolvePendingChoice,
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
vi.mock("@/lib/chat/query-rewrite", () => ({ rewriteSearchQueries: rewriteMock.rewriteSearchQueries }))
vi.mock("@/lib/chat/web-trigger", () => ({ detectExternalVerificationNeed: webTriggerMock.detectExternalVerificationNeed }))
vi.mock("@/lib/chat/post-read", () => ({
  detectPostReviewIntent: postReadMock.detectPostReviewIntent,
  loadNewestPostForPrompt: postReadMock.loadNewestPostForPrompt,
}))

import { runChatTurn, type TurnEvent } from "@/lib/chat/chat-turn"

async function drain(events: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

function setupOk() {
  chatMock.createThread.mockResolvedValue({
    id: "t-new", title: "Hi", created_at: "2026-07-11", updated_at: "2026-07-11",
    model_preference: null, one_turn_override: null, purpose: "chat", subject_type: null, subject_key: null,
  })
  chatMock.getThread.mockResolvedValue({
    id: "t-new", title: "Hi", created_at: "2026-07-11", updated_at: "2026-07-11",
    model_preference: null, one_turn_override: null, purpose: "chat", subject_type: null, subject_key: null,
  })
  chatMock.consumeOneTurnOverride.mockResolvedValue(null)
  chatMock.appendMessage.mockResolvedValue({
    id: "m1", thread_id: "t-new", role: "user", content: "hi", tool_calls: null, created_at: "2026-07-11",
  })
  chatMock.getMessages.mockResolvedValue([])
  chatMock.recallMemories.mockResolvedValue([])
  awarenessMock.buildSiteContext.mockResolvedValue("SITE_CTX")
  modelsMock.classifyDifficultyHybrid.mockResolvedValue({ band: "easy", via: "heuristic" })
  tavilyMock.searchWeb.mockResolvedValue({ provider: "tavily", query: "", searchedAt: new Date().toISOString(), sources: [] })
  tavilyMock.formatWebEvidence.mockReturnValue("")
  tavilyMock.formatWebEvidenceGuarded.mockReturnValue("")
  tavilyMock.subjectInSources.mockReturnValue(true)
  tavilyMock.mergeWebResearch.mockImplementation((studies: any[]) =>
    studies[0] ?? { provider: "tavily", query: "", searchedAt: "", sources: [] }
  )
  tavilyMock.rankSources.mockImplementation((srcs: any[]) => srcs)
  tavilyMock.extractPages.mockResolvedValue({ pages: [], failed: [] })
  mistralMock.reasoningEffortForModel.mockReturnValue(undefined)
  rewriteMock.rewriteSearchQueries.mockImplementation(async (msg: string) => ({ queries: [msg], subject: null }))
  webTriggerMock.detectExternalVerificationNeed.mockReturnValue({ suggested: false })
  chatMock.insertPendingChoice.mockResolvedValue({
    id: "p1", thread_id: "t-new", user_message_id: "m1", reason: "external-prerequisites",
    subject: "Kubernetes", message_text: "x", created_at: "2026-07-19T00:00:00Z", resolved_at: null, choice: null,
  })
  chatMock.loadPendingChoice.mockResolvedValue(null)
  chatMock.resolvePendingChoice.mockResolvedValue(null)
  postReadMock.detectPostReviewIntent.mockReturnValue(false)
  postReadMock.loadNewestPostForPrompt.mockResolvedValue(null)
}

describe("runChatTurn — suggestion pause (pause-before-synthesize)", () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.TAVILY_API_KEY })

  it("auto + detector PROPOSES → {kind:paused}, no synthesis, no search, no override consumed, no classifier", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    webTriggerMock.detectExternalVerificationNeed.mockReturnValue({
      suggested: true, reason: "external-prerequisites", subject: "Kubernetes",
    })
    chatMock.appendMessage.mockResolvedValueOnce({
      id: "m-user", thread_id: "t-new", role: "user",
      content: "which are the prerequisites for Kubernetes?", tool_calls: null, created_at: "2026-07-19",
    })
    chatMock.insertPendingChoice.mockResolvedValueOnce({
      id: "p1", thread_id: "t-new", user_message_id: "m-user", reason: "external-prerequisites",
      subject: "Kubernetes", message_text: "which are the prerequisites for Kubernetes?",
      created_at: "2026-07-19T00:00:00Z", resolved_at: null, choice: null,
    })

    const result = await runChatTurn({
      body: { message: "which are the prerequisites for Kubernetes?" },
      userId: "admin-1",
    })

    // The discriminated result is the pause — not a stream.
    expect(result.kind).toBe("paused")
    if (result.kind !== "paused") return
    expect(result.threadId).toBe("t-new")
    expect(result.pendingChoice).toEqual({ id: "p1", reason: "external-prerequisites", subject: "Kubernetes" })

    // Pause-before-synthesize invariants: only the user row was appended +
    // 1 pending insert. No assistant row, no model call, no search.
    expect(chatMock.appendMessage).toHaveBeenCalledTimes(1)
    expect(chatMock.appendMessage.mock.calls[0][0].role).toBe("user")
    expect(chatMock.insertPendingChoice).toHaveBeenCalledTimes(1)
    expect(chatMock.insertPendingChoice.mock.calls[0][0]).toMatchObject({
      threadId: "t-new", userMessageId: "m-user", reason: "external-prerequisites",
      subject: "Kubernetes", messageText: "which are the prerequisites for Kubernetes?",
    })
    expect(mistralMock.mistralStream).not.toHaveBeenCalled()
    expect(tavilyMock.searchWeb).not.toHaveBeenCalled()
    // The suggestion turn does NOT consume the one-turn override or run the
    // hybrid classifier (no synthesis → no model resolution).
    expect(chatMock.consumeOneTurnOverride).not.toHaveBeenCalled()
    expect(modelsMock.classifyDifficultyHybrid).not.toHaveBeenCalled()
  })

  it("auto + detector does NOT propose → {kind:stream}, site-first synthesis, no pending insert", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    webTriggerMock.detectExternalVerificationNeed.mockReturnValue({ suggested: false })
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("site-first answer")
      return { role: "assistant", content: "site-first answer", tool_calls: [], finish_reason: "stop" }
    })

    const result = await runChatTurn({ body: { message: "hi" }, userId: "admin-1" })
    expect(result.kind).toBe("stream")
    if (result.kind !== "stream") return
    const events = await drain(result.events)
    const types = events.map((e) => e.type)
    expect(types).toContain("thread")
    expect(types).toContain("model")
    expect(types).toContain("done")
    expect(webTriggerMock.detectExternalVerificationNeed).toHaveBeenCalledTimes(1)
    expect(chatMock.insertPendingChoice).not.toHaveBeenCalled()
    expect(tavilyMock.searchWeb).not.toHaveBeenCalled()
    expect(mistralMock.mistralStream).toHaveBeenCalled()
  })

  it("auto + key missing → detection never runs, no pause, site-first synthesis (no silent search)", async () => {
    setupOk()
    // No TAVILY_API_KEY
    webTriggerMock.detectExternalVerificationNeed.mockReturnValue({ suggested: true })
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("site-first")
      return { role: "assistant", content: "site-first", tool_calls: [], finish_reason: "stop" }
    })
    const result = await runChatTurn({ body: { message: "which are the prerequisites for Kubernetes?" }, userId: "admin-1" })
    expect(result.kind).toBe("stream")
    if (result.kind !== "stream") return
    await drain(result.events)
    expect(webTriggerMock.detectExternalVerificationNeed).not.toHaveBeenCalled()
    expect(tavilyMock.searchWeb).not.toHaveBeenCalled()
    expect(chatMock.insertPendingChoice).not.toHaveBeenCalled()
    expect(mistralMock.mistralStream).toHaveBeenCalled()
  })
})

describe("runChatTurn — resume contract (idempotent + httpError mapping)", () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.TAVILY_API_KEY })

  function pendingRow(over: Record<string, unknown> = {}) {
    return {
      id: "p1", thread_id: "t-resume", user_message_id: "m-user", reason: "external-prerequisites",
      subject: "Kubernetes", message_text: "which are the prerequisites for Kubernetes?",
      created_at: "2026-07-19T00:00:00Z", resolved_at: null, choice: null, ...over,
    }
  }

  it("resume with a missing pending row → {kind:httpError, status:404}, no synthesis", async () => {
    setupOk()
    chatMock.loadPendingChoice.mockResolvedValueOnce(null)
    const result = await runChatTurn({
      body: { threadId: "t-resume", sourceChoice: "search", pendingChoiceId: "missing" },
      userId: "admin-1",
    })
    expect(result).toEqual({ kind: "httpError", status: 404, error: "Choice no longer pending" })
    expect(chatMock.resolvePendingChoice).not.toHaveBeenCalled()
    expect(mistralMock.mistralStream).not.toHaveBeenCalled()
  })

  it("re-resume an already-resolved pending → {kind:httpError, status:409}, no resolve, no synthesis", async () => {
    setupOk()
    chatMock.loadPendingChoice.mockResolvedValueOnce(pendingRow({ resolved_at: "2026-07-19T00:00:05Z", choice: "stay" }))
    const result = await runChatTurn({
      body: { threadId: "t-resume", sourceChoice: "stay", pendingChoiceId: "p1" },
      userId: "admin-1",
    })
    expect(result).toEqual({ kind: "httpError", status: 409, error: "Choice no longer pending" })
    expect(chatMock.resolvePendingChoice).not.toHaveBeenCalled()
    expect(mistralMock.mistralStream).not.toHaveBeenCalled()
  })

  it("resume with an invalid choice → {kind:httpError, status:400}", async () => {
    setupOk()
    const result = await runChatTurn({
      body: { threadId: "t-resume", sourceChoice: "maybe" as any, pendingChoiceId: "p1" },
      userId: "admin-1",
    })
    expect(result).toEqual({ kind: "httpError", status: 400, error: "Invalid source choice" })
  })

  it("resume without a threadId → {kind:httpError, status:400}", async () => {
    setupOk()
    const result = await runChatTurn({
      body: { sourceChoice: "search", pendingChoiceId: "p1" },
      userId: "admin-1",
    })
    expect(result).toEqual({ kind: "httpError", status: 400, error: "threadId required to resume" })
  })

  it("decline → {kind:stream} with scope label in the system prompt, NO search, pending resolved", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    chatMock.loadPendingChoice.mockResolvedValueOnce(pendingRow())
    chatMock.resolvePendingChoice.mockResolvedValueOnce(pendingRow({ resolved_at: "x", choice: "stay" }))
    chatMock.getThread.mockResolvedValue({
      id: "t-resume", title: "Kubernetes", created_at: "2026-07-19", updated_at: "2026-07-19",
      model_preference: "auto", one_turn_override: null, purpose: "chat", subject_type: null, subject_key: null,
    })
    chatMock.getMessages.mockResolvedValue([
      { id: "m-user", thread_id: "t-resume", role: "user", content: "which are the prerequisites for Kubernetes?", tool_calls: null, created_at: "2026-07-19" },
    ])
    let capturedSystem = ""
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      capturedSystem = opts.messages[0].content
      opts.onContent?.("site-scoped answer")
      return { role: "assistant", content: "site-scoped answer", tool_calls: [], finish_reason: "stop" }
    })

    const result = await runChatTurn({
      body: { threadId: "t-resume", sourceChoice: "stay", pendingChoiceId: "p1" },
      userId: "admin-1",
    })
    expect(result.kind).toBe("stream")
    if (result.kind !== "stream") return
    const events = await drain(result.events)

    expect(chatMock.resolvePendingChoice).toHaveBeenCalledWith("p1", "stay")
    expect(tavilyMock.searchWeb).not.toHaveBeenCalled()
    // No web_* events on a stay-decline turn.
    expect(events.some((e) => e.type === "web_sources" || e.type === "web_status")).toBe(false)
    // Scope label injected into the system prompt.
    expect(capturedSystem).toContain("[SCOPE]")
    expect(capturedSystem).toContain("may not reflect current public information")
    // The user row was NOT re-appended (only the assistant row).
    const userAppends = chatMock.appendMessage.mock.calls.filter((c: any[]) => c[0]?.role === "user")
    expect(userAppends).toHaveLength(0)
    // Detection does NOT re-run on resume.
    expect(webTriggerMock.detectExternalVerificationNeed).not.toHaveBeenCalled()
  })

  it("decline + model emits web_search → tool guard blocks (no Tavily call) — stay-gates-web_search", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    chatMock.loadPendingChoice.mockResolvedValueOnce(pendingRow())
    chatMock.resolvePendingChoice.mockResolvedValueOnce(pendingRow({ resolved_at: "x", choice: "stay" }))
    chatMock.getThread.mockResolvedValue({
      id: "t-resume", title: "Kubernetes", created_at: "2026-07-19", updated_at: "2026-07-19",
      model_preference: "auto", one_turn_override: null, purpose: "chat", subject_type: null, subject_key: null,
    })
    chatMock.getMessages.mockResolvedValue([
      { id: "m-user", thread_id: "t-resume", role: "user", content: "which are the prerequisites for Kubernetes?", tool_calls: null, created_at: "2026-07-19" },
    ])
    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        return {
          role: "assistant", content: "",
          tool_calls: [{ id: "call_ws", type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: "Kubernetes prerequisites", subject: "Kubernetes" }) } }],
          finish_reason: "tool_calls",
        }
      }
      opts.onContent?.("site-scoped answer")
      return { role: "assistant", content: "site-scoped answer", tool_calls: [], finish_reason: "stop" }
    })

    const result = await runChatTurn({
      body: { threadId: "t-resume", sourceChoice: "stay", pendingChoiceId: "p1" },
      userId: "admin-1",
    })
    expect(result.kind).toBe("stream")
    if (result.kind !== "stream") return
    const events = await drain(result.events)

    const toolEvents = events.filter((e) => e.type === "tool")
    const wsDone = toolEvents.find((e) => e.type === "tool" && e.name === "web_search" && e.status === "done")
    expect(wsDone, "web_search done event expected").toBeTruthy()
    // The webTouched guard refused it (no real Tavily call) and the tool
    // result carries the stay/no-web guard message.
    expect(String((wsDone as any).result)).toMatch(/not available this turn|stay on this site|not (enabled|authorized)/i)
    expect(tavilyMock.searchWeb).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === "done")).toBe(true)
  })

  it("approve → {kind:stream}, runs the audited web pipeline, does NOT re-append the user row", async () => {
    setupOk()
    process.env.TAVILY_API_KEY = "tvly-test"
    chatMock.loadPendingChoice.mockResolvedValueOnce(pendingRow())
    chatMock.resolvePendingChoice.mockResolvedValueOnce(pendingRow({ resolved_at: "x", choice: "search" }))
    chatMock.getThread.mockResolvedValue({
      id: "t-resume", title: "Kubernetes", created_at: "2026-07-19", updated_at: "2026-07-19",
      model_preference: "auto", one_turn_override: null, purpose: "chat", subject_type: null, subject_key: null,
    })
    chatMock.getMessages.mockResolvedValue([
      { id: "m-user", thread_id: "t-resume", role: "user", content: "which are the prerequisites for Kubernetes?", tool_calls: null, created_at: "2026-07-19" },
    ])
    rewriteMock.rewriteSearchQueries.mockResolvedValue({ queries: ["Kubernetes prerequisites"], subject: "Kubernetes" })
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily", query: "Kubernetes prerequisites", searchedAt: "x",
      sources: [{ title: "K8s docs", url: "https://k8s.io", domain: "k8s.io", snippet: "prereqs", score: 0.9 }],
    })
    tavilyMock.mergeWebResearch.mockImplementation((s: any[]) => s[0])
    tavilyMock.rankSources.mockImplementation((s: any[]) => s)
    tavilyMock.subjectInSources.mockReturnValue(true)
    tavilyMock.extractPages.mockResolvedValue({ pages: [], failed: [] })
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue("[EVIDENCE]")
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("audited answer")
      return { role: "assistant", content: "audited answer", tool_calls: [], finish_reason: "stop" }
    })

    const result = await runChatTurn({
      body: { threadId: "t-resume", sourceChoice: "search", pendingChoiceId: "p1" },
      userId: "admin-1",
    })
    expect(result.kind).toBe("stream")
    if (result.kind !== "stream") return
    const events = await drain(result.events)

    expect(chatMock.loadPendingChoice).toHaveBeenCalledWith("p1", "t-resume")
    expect(chatMock.resolvePendingChoice).toHaveBeenCalledWith("p1", "search")
    expect(tavilyMock.searchWeb).toHaveBeenCalledWith("Kubernetes prerequisites")
    expect(events.some((e) => e.type === "done")).toBe(true)
    const userAppends = chatMock.appendMessage.mock.calls.filter((c: any[]) => c[0]?.role === "user")
    expect(userAppends).toHaveLength(0)
    expect(webTriggerMock.detectExternalVerificationNeed).not.toHaveBeenCalled()
  })
})

describe("runChatTurn — capture-by-model-call-visibility (audit ordering invariant)", () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.TAVILY_API_KEY })

  it("first assistant row snapshots only the pipeline run; the second (after web_search) has pipeline + tool", async () => {
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

    const result = await runChatTurn({ body: { message: "how good is Kimi K3?", webEnabled: true }, userId: "admin-1" })
    expect(result.kind).toBe("stream")
    if (result.kind !== "stream") return
    await drain(result.events)

    const assistantCalls = chatMock.appendMessage.mock.calls.filter((c: any[]) => c[0]?.role === "assistant")
    expect(assistantCalls).toHaveLength(2)
    // First assistant row (tool-call stub) has only the pipeline run — the
    // tool hasn't run yet at that snapshot.
    const firstAudit = assistantCalls[0][0].webResearch
    expect(firstAudit.runs).toHaveLength(1)
    expect(firstAudit.runs[0].via).toBe("pipeline")
    // Second assistant row (final answer, AFTER the web_search tool result)
    // has pipeline + tool — the ordering invariant holds.
    const secondAudit = assistantCalls[1][0].webResearch
    expect(secondAudit.runs).toHaveLength(2)
    expect(secondAudit.runs[0].via).toBe("pipeline")
    expect(secondAudit.runs[1].via).toBe("tool")
  })
})

describe("runChatTurn — message + thread httpError mapping", () => {
  beforeEach(() => vi.clearAllMocks())

  it("empty message → {kind:httpError, status:400}", async () => {
    setupOk()
    const result = await runChatTurn({ body: { message: "   " }, userId: "admin-1" })
    expect(result).toEqual({ kind: "httpError", status: 400, error: "Missing message" })
  })

  it("over-long message → {kind:httpError, status:413}", async () => {
    setupOk()
    const result = await runChatTurn({ body: { message: "x".repeat(4001) }, userId: "admin-1" })
    expect(result).toEqual({ kind: "httpError", status: 413, error: "Message too long (≤4000 chars)" })
  })

  it("companion-purpose thread id → {kind:httpError, status:400}", async () => {
    setupOk()
    chatMock.getThread.mockResolvedValue({
      id: "c1", title: "Companion: post post-1", created_at: "2026-07-11", updated_at: "2026-07-11",
      model_preference: null, one_turn_override: null, purpose: "blog-companion", subject_type: "post", subject_key: "post-1",
    })
    const result = await runChatTurn({ body: { threadId: "c1", message: "hi" }, userId: "admin-1" })
    expect(result).toEqual({ kind: "httpError", status: 400, error: "Thread not available for chat" })
    expect(chatMock.appendMessage).not.toHaveBeenCalled()
    expect(chatMock.createThread).not.toHaveBeenCalled()
  })
})