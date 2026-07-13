import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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
    // read_code is not in the offered tool set → refused at the offered-set
    // boundary (Fix A) before reaching the dispatcher allowlist. Either refusal
    // message is acceptable; both refuse it with no proposal emitted.
    expect(
      toolEvents.some(
        (e) =>
          /Skipped.*not offered/i.test(String((e as any).result ?? "")) ||
          /Tool unavailable in writing companion/.test(String((e as any).result ?? ""))
      )
    ).toBe(true)
    expect(events.some((e) => e.type === "proposal")).toBe(false)
  })

  it("dedupes identical proposal cards within one response (field, original, replacement)", async () => {
    // Remedy A (advisor phase-B3): dedupe identical propose_edit attempts BEFORE
    // execution. A model that re-emits the same edit (the live trace did) collapses
    // to one card; the second identical call is skipped pre-execution with a
    // "Duplicate propose_edit skipped" tool result. A post-match guard remains
    // for semantically-identical successful proposals that diverge in raw args
    // but normalize together after proposal construction.
    setupOk()
    const dupArgs = JSON.stringify({
      field: "body",
      original: "The opening repeats the title.",
      replacement: "The opening restates the premise.",
      rationale: "Diagnosis: repeats. Basis: SW1. Tradeoff: none.",
      principleId: "SW1",
    })
    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        opts.onContent?.("Findings: repetition.")
        return {
          role: "assistant",
          content: "Findings: repetition.",
          tool_calls: [
            { id: "call_a", type: "function", function: { name: "propose_edit", arguments: dupArgs } },
            { id: "call_b", type: "function", function: { name: "propose_edit", arguments: dupArgs } },
          ],
          finish_reason: "tool_calls",
        }
      }
      opts.onContent?.("Done.")
      return { role: "assistant", content: "Done.", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full" }))
    const events = await drainSSE(res)
    const proposals = events.filter((e) => e.type === "proposal")
    expect(proposals.length).toBe(1)
    expect((proposals[0] as any).field).toBe("body")
    // The skipped duplicate is surfaced as a tool note, not silently swallowed.
    const toolResults = events.filter((e) => e.type === "tool").map((e) => (e as any).result ?? "")
    expect(toolResults.some((r) => r.match(/Duplicate propose_edit skipped/i))).toBe(true)
  })

  it("three identical failing raw tool calls → one anchor error + two duplicate-skipped (advisor phase-B3 Remedy A)", async () => {
    // The live "found 0 × 3" failure: a model hammers a misquoted anchor. Pre-
    // execution dedupe collapses the repeats — only the FIRST attempt runs and
    // fails at anchor match; the rest are skipped as duplicates (advisor test #1).
    setupOk()
    const badArgs = JSON.stringify({
      field: "body",
      original: "This passage does not appear anywhere in the draft body.",
      replacement: "A replacement.",
      rationale: "Diagnosis: x. Basis: Z1. Tradeoff: none.",
      principleId: "Z1",
    })
    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        return {
          role: "assistant",
          content: "Findings.",
          tool_calls: [
            { id: "c1", type: "function", function: { name: "propose_edit", arguments: badArgs } },
            { id: "c2", type: "function", function: { name: "propose_edit", arguments: badArgs } },
            { id: "c3", type: "function", function: { name: "propose_edit", arguments: badArgs } },
          ],
          finish_reason: "tool_calls",
        }
      }
      opts.onContent?.("Done.")
      return { role: "assistant", content: "Done.", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full" }))
    const events = await drainSSE(res)
    const proposals = events.filter((e) => e.type === "proposal")
    expect(proposals.length).toBe(0)
    const toolResults = events.filter((e) => e.type === "tool").map((e) => (e as any).result ?? "")
    // First attempt runs → anchor fails (found 0). Repeats are skipped pre-execution.
    expect(toolResults.filter((r) => /must occur exactly once/.test(r)).length).toBe(1)
    expect(toolResults.filter((r) => /Duplicate propose_edit skipped/i.test(r)).length).toBe(2)
  })

  it("a corrected anchor after failure remains allowed (different original → not deduped)", async () => {
    // Remedy A must not over-block: a model that retries with a FIXED anchor
    // (different `original`) gets a different dedupe key and is allowed to run
    // (advisor test #2). This is the guard against the dedupe swallowing legit retries.
    setupOk()
    const badArgs = JSON.stringify({
      field: "body",
      original: "This passage does not appear anywhere in the draft body.",
      replacement: "A replacement.",
      rationale: "Diagnosis: x. Basis: Z1. Tradeoff: none.",
      principleId: "Z1",
    })
    const goodArgs = JSON.stringify({
      field: "body",
      original: "The opening repeats the title.",
      replacement: "The opening restates the premise.",
      rationale: "Diagnosis: repeats. Basis: SW1. Tradeoff: none.",
      principleId: "SW1",
    })
    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        return {
          role: "assistant",
          content: "Findings.",
          tool_calls: [
            { id: "c1", type: "function", function: { name: "propose_edit", arguments: badArgs } },
            { id: "c2", type: "function", function: { name: "propose_edit", arguments: goodArgs } },
          ],
          finish_reason: "tool_calls",
        }
      }
      opts.onContent?.("Done.")
      return { role: "assistant", content: "Done.", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full" }))
    const events = await drainSSE(res)
    const proposals = events.filter((e) => e.type === "proposal")
    // The corrected retry (goodArgs) succeeds → one proposal.
    expect(proposals.length).toBe(1)
    expect((proposals[0] as any).field).toBe("body")
    const toolResults = events.filter((e) => e.type === "tool").map((e) => (e as any).result ?? "")
    // The bad anchor fails once; the good anchor is NOT skipped (different key).
    expect(toolResults.filter((r) => /must occur exactly once/.test(r)).length).toBe(1)
    expect(toolResults.some((r) => /Duplicate propose_edit skipped/i.test(r))).toBe(false)
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

describe("POST /api/blog-companion — fiction structured terminal + reasoning stream", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fiction mode selects submit_fiction_review, NOT propose_edit, in the tools array", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async () => ({ role: "assistant", content: "Clean.", tool_calls: [], finish_reason: "stop" }))
    await POST(makeRequest({ message: "review this story", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full", reviewMode: "fiction" }))
    const tools = (mistralMock.mistralStream.mock.calls[0][0] as any).tools as { function: { name: string } }[]
    const names = tools.map((t) => t.function.name)
    expect(names).toContain("submit_fiction_review")
    expect(names).not.toContain("propose_edit")
  })

  it("non-fiction mode keeps propose_edit (no submit_fiction_review)", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async () => ({ role: "assistant", content: "x", tool_calls: [], finish_reason: "stop" }))
    await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full", reviewMode: "prose" }))
    const tools = (mistralMock.mistralStream.mock.calls[0][0] as any).tools as { function: { name: string } }[]
    const names = tools.map((t) => t.function.name)
    expect(names).toContain("propose_edit")
    expect(names).not.toContain("submit_fiction_review")
  })

  it("forwards onReasoning chunks as reasoning SSE events", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onReasoning?.("the trace")
      opts.onContent?.("the answer")
      return { role: "assistant", content: "the answer", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full", reviewMode: "fiction" }))
    const events = await drainSSE(res)
    const reasoning = events.filter((e) => e.type === "reasoning")
    expect(reasoning.length).toBe(1)
    expect((reasoning[0] as any).delta).toBe("the trace")
  })

  it("fiction preamble content is truncated to 2 sentences", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("One. Two. Three. Four.")
      return { role: "assistant", content: "One. Two. Three. Four.", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full", reviewMode: "fiction" }))
    const events = await drainSSE(res)
    const content = events.filter((e) => e.type === "content").map((e) => (e as any).delta).join("")
    expect(content).toBe("One. Two.")
    expect(content).not.toContain("Three")
    expect(content).not.toContain("Four")
  })

  it("non-fiction content is NOT truncated (all sentences forwarded)", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("One. Two. Three. Four.")
      return { role: "assistant", content: "One. Two. Three. Four.", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full", reviewMode: "prose" }))
    const events = await drainSSE(res)
    const content = events.filter((e) => e.type === "content").map((e) => (e as any).delta).join("")
    expect(content).toBe("One. Two. Three. Four.")
  })

  it("submit_fiction_review emits a fiction_review event + a proposal per finding-edit", async () => {
    setupOk()
    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        opts.onContent?.("One clean fix here.")
        return {
          role: "assistant",
          content: "One clean fix here.",
          tool_calls: [
            {
              id: "fr1",
              type: "function",
              function: {
                name: "submit_fiction_review",
                arguments: JSON.stringify({
                  assessment: "Opening tense inconsistency; one surgical fix.",
                  noChange: false,
                  findings: [
                    {
                      diagnosis: "Tense shift in the opening.",
                      principleId: "Z2",
                      original: "The opening repeats the title.",
                      replacement: "The opening restates the premise.",
                      rationale: "Diagnosis: tense. Basis: Z2. Tradeoff: none.",
                    },
                  ],
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
    const res = await POST(makeRequest({ message: "review this story", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full", reviewMode: "fiction" }))
    const events = await drainSSE(res)
    const review = events.find((e) => e.type === "fiction_review")
    expect(review).toBeDefined()
    expect((review as any).noChange).toBe(false)
    expect((review as any).assessment).toBe("Opening tense inconsistency; one surgical fix.")
    expect((review as any).findings[0].hasEdit).toBe(true)
    const proposals = events.filter((e) => e.type === "proposal")
    expect(proposals.length).toBe(1)
    expect((proposals[0] as any).field).toBe("body")
    expect((proposals[0] as any).original).toBe("The opening repeats the title.")
  })

  it("submit_fiction_review noChange:true emits a NO CHANGE fiction_review, 0 proposals", async () => {
    setupOk()
    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        return {
          role: "assistant",
          content: "Clean.",
          tool_calls: [
            { id: "fr1", type: "function", function: { name: "submit_fiction_review", arguments: JSON.stringify({ assessment: "Clean draft.", noChange: true, findings: [] }) } },
          ],
          finish_reason: "tool_calls",
        }
      }
      opts.onContent?.("Done.")
      return { role: "assistant", content: "Done.", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "review this story", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "full", reviewMode: "fiction" }))
    const events = await drainSSE(res)
    const review = events.find((e) => e.type === "fiction_review")
    expect((review as any).noChange).toBe(true)
    expect(events.filter((e) => e.type === "proposal").length).toBe(0)
  })

  it("fiction mode strips a hallucinated propose_edit tool call (no proposal, no history entry, skip event)", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("Preamble only.")
      return {
        role: "assistant",
        content: "Preamble only.",
        tool_calls: [
          // hallucinated: propose_edit is NOT offered in fiction mode
          {
            id: "pe1",
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
    const res = await POST(makeRequest({ message: "check scene movement", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "section", reviewMode: "fiction" }))
    const events = await drainSSE(res)
    // no proposal emitted from the hallucinated call
    expect(events.filter((e) => e.type === "proposal").length).toBe(0)
    // a skip tool event surfaced for transparency
    const skip = events.find((e) => e.type === "tool" && /Skipped/i.test(String((e as any).result ?? "")))
    expect(skip).toBeDefined()
    expect(/propose_edit is not offered/.test(String((skip as any).result))).toBe(true)
    // the persisted assistant row carries NO tool_calls (propose_edit must not enter history → no Mistral 3230 next turn)
    const assistantAppends = chatMock.appendMessage.mock.calls.filter((c) => c[0].role === "assistant")
    expect(assistantAppends.length).toBeGreaterThanOrEqual(1)
    const lastAssistant = assistantAppends[assistantAppends.length - 1][0]
    expect(lastAssistant.toolCalls).toBeUndefined()
  })

  it("fiction mode keeps a hallucinated propose_edit out of the next turn's request (no 3230)", async () => {
    setupOk()
    let call = 0
    const seenMessages: any[] = []
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      seenMessages.push(opts.messages)
      if (call === 1) {
        return {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "pe1", type: "function", function: { name: "propose_edit", arguments: JSON.stringify({ field: "body", original: "The opening repeats the title.", replacement: "x", rationale: "Diagnosis: r. Basis: SW1. Tradeoff: none.", principleId: "SW1" }) } }],
          finish_reason: "tool_calls",
        }
      }
      return { role: "assistant", content: "done", tool_calls: [], finish_reason: "stop" }
    })
    await POST(makeRequest({ message: "check scene movement", subjectType: "post", subjectKey: "post-1", draft: DRAFT, scope: "section", reviewMode: "fiction" }))
    // turn 1 happened; because the only call was stripped, the loop breaks and
    // there is NO turn 2 (calls.length === 0 → break). So no second mistralStream
    // call, and no chance to send an unbalanced/propose_edit-bearing history back.
    expect(call).toBe(1)
    // the messages sent on turn 1 contain no propose_edit tool_call in the
    // assistant turn (the hallucinated call never reached history).
    const turn1 = seenMessages[0]
    expect(turn1.some((m: any) => m.role === "assistant" && m.tool_calls?.some?.((tc: any) => tc.function?.name === "propose_edit"))).toBe(false)
  })
})

// ── Advisor phase B9 ───────────────────────────────────────────────────────
// Per-turn telemetry (response_model is the decisive confound field) + a
// non-mutating pseudo-tool bypass notice (the structured terminal is the only
// edit path in fiction mode; narrating propose_edit:{...} as prose bypasses it).
// See VERDICT-phaseB9.md Q1 + Q6.
describe("POST /api/blog-companion — telemetry + protocol_bypass (advisor phase B9)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.COMPANION_TELEMETRY
  })
  afterEach(() => {
    delete process.env.COMPANION_TELEMETRY
  })

  it("emits a telemetry event per fiction turn with response_model + reasoning_effort_sent", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ASSESSMENT: ok.")
      return {
        role: "assistant",
        content: "ASSESSMENT: ok.",
        tool_calls: [],
        finish_reason: "stop",
        response_model: "mistral-medium-3-5",
        reasoning_effort_sent: "high",
        content_chunk_types: ["text"],
        reasoning_chars: 0,
        text_chars: 14,
      }
    })
    const res = await POST(
      makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, reviewMode: "fiction", scope: "section" })
    )
    const events = await drainSSE(res)
    const tel = events.find((e) => e.type === "telemetry")
    expect(tel).toBeDefined()
    expect((tel as any).response_model).toBe("mistral-medium-3-5")
    expect((tel as any).reasoning_effort_sent).toBe("high")
    expect((tel as any).requested_model).toBe("mistral-medium-latest") // mocked MODEL_TIERS.medium
    expect((tel as any).scope).toBe("section")
    expect((tel as any).tier).toBe("medium")
    expect(Array.isArray(tel?.tools_offered)).toBe(true)
    expect((tel as any).fiction_terminal_called).toBe(false)
  })

  it("emits a protocol_bypass event when fiction content narrates propose_edit and the terminal was not called", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ASSESSMENT: ok.")
      return {
        role: "assistant",
        content:
          "ASSESSMENT: ok.\npropose_edit:{'field': 'body', 'original': 'x', 'replacement': 'y', 'rationale': 'Diagnosis: tense. Basis: Z2.', 'principleId': 'Z2'}",
        tool_calls: [],
        finish_reason: "stop",
      }
    })
    const res = await POST(
      makeRequest({ message: "check scene movement", subjectType: "post", subjectKey: "post-1", draft: DRAFT, reviewMode: "fiction", scope: "section" })
    )
    const events = await drainSSE(res)
    const bypass = events.find((e) => e.type === "protocol_bypass")
    expect(bypass).toBeDefined()
    expect((bypass as any).tool).toBe("propose_edit")
    expect(typeof (bypass as any).notice).toBe("string")
    expect((bypass as any).notice).toMatch(/unsubmitted edit payload/i)
    // No proposal was created from the narrated payload (no laundering of prose
    // into an action — the verdict's Q6 rule).
    expect(events.filter((e) => e.type === "proposal")).toHaveLength(0)
  })

  it("does NOT emit protocol_bypass when the terminal was actually called (real submit_fiction_review)", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ASSESSMENT: ok.")
      return {
        role: "assistant",
        content: "ASSESSMENT: ok.",
        tool_calls: [
          {
            id: "fr1",
            type: "function",
            function: {
              name: "submit_fiction_review",
              arguments: JSON.stringify({ assessment: "ok", noChange: true, findings: [] }),
            },
          },
        ],
        finish_reason: "tool_calls",
      }
    })
    const res = await POST(
      makeRequest({ message: "review this story", subjectType: "post", subjectKey: "post-1", draft: DRAFT, reviewMode: "fiction", scope: "full" })
    )
    const events = await drainSSE(res)
    expect(events.find((e) => e.type === "protocol_bypass")).toBeFalsy()
  })

  it("does not emit telemetry in prose mode unless COMPANION_TELEMETRY is set", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, reviewMode: "prose" }))
    const events = await drainSSE(res)
    expect(events.find((e) => e.type === "telemetry")).toBeFalsy()
  })

  it("emits telemetry in prose mode when COMPANION_TELEMETRY is set", async () => {
    setupOk()
    process.env.COMPANION_TELEMETRY = "1"
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ok")
      return { role: "assistant", content: "ok", tool_calls: [], finish_reason: "stop", response_model: "mistral-medium-latest" }
    })
    const res = await POST(makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, reviewMode: "prose" }))
    const events = await drainSSE(res)
    const tel = events.find((e) => e.type === "telemetry")
    expect(tel).toBeDefined()
    expect((tel as any).response_model).toBe("mistral-medium-latest")
  })
})

describe("POST /api/blog-companion — terminal_expected notice (advisor phase B10 Q5)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.COMPANION_TELEMETRY
  })
  afterEach(() => {
    delete process.env.COMPANION_TELEMETRY
  })

  it("emits terminal_expected when a fiction turn ends stop with no terminal call and no bypass", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("NO CHANGE. The draft holds up.")
      return {
        role: "assistant",
        content: "NO CHANGE. The draft holds up.",
        tool_calls: [],
        finish_reason: "stop",
      }
    })
    const res = await POST(
      makeRequest({ message: "review this story", subjectType: "post", subjectKey: "post-1", draft: DRAFT, reviewMode: "fiction", scope: "full" })
    )
    const events = await drainSSE(res)
    const te = events.find((e) => e.type === "terminal_expected")
    expect(te).toBeDefined()
    expect((te as any).notice).toBe(
      "Review completed without the required fiction terminal submission; no validated findings or edit cards were created."
    )
  })

  it("does NOT emit terminal_expected when submit_fiction_review was called", async () => {
    setupOk()
    let call = 0
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      call += 1
      if (call === 1) {
        return {
          role: "assistant",
          content: "ASSESSMENT: ok.",
          tool_calls: [
            { id: "fr1", type: "function", function: { name: "submit_fiction_review", arguments: JSON.stringify({ assessment: "ok", noChange: true, findings: [] }) } },
          ],
          finish_reason: "tool_calls",
        }
      }
      opts.onContent?.("Done.")
      return { role: "assistant", content: "Done.", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(
      makeRequest({ message: "review this story", subjectType: "post", subjectKey: "post-1", draft: DRAFT, reviewMode: "fiction", scope: "full" })
    )
    const events = await drainSSE(res)
    expect(events.find((e) => e.type === "terminal_expected")).toBeFalsy()
  })

  it("does NOT emit terminal_expected when a prose bypass fired (the bypass notice covers it)", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("ASSESSMENT: ok.")
      return {
        role: "assistant",
        content: "ASSESSMENT: ok.\npropose_edit:{'field':'body','original':'x','replacement':'y','rationale':'r','principleId':'Z2'}",
        tool_calls: [],
        finish_reason: "stop",
      }
    })
    const res = await POST(
      makeRequest({ message: "check scene movement", subjectType: "post", subjectKey: "post-1", draft: DRAFT, reviewMode: "fiction", scope: "section" })
    )
    const events = await drainSSE(res)
    expect(events.find((e) => e.type === "protocol_bypass")).toBeDefined()
    expect(events.find((e) => e.type === "terminal_expected")).toBeFalsy()
  })

  it("does NOT emit terminal_expected on a length finish (cap-exhaustion, not the skip mode)", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("FINDING 1: ...")
      return { role: "assistant", content: "FINDING 1: ...", tool_calls: [], finish_reason: "length" }
    })
    const res = await POST(
      makeRequest({ message: "review this story", subjectType: "post", subjectKey: "post-1", draft: DRAFT, reviewMode: "fiction", scope: "full" })
    )
    const events = await drainSSE(res)
    expect(events.find((e) => e.type === "terminal_expected")).toBeFalsy()
  })

  it("does NOT emit terminal_expected in prose mode (fiction-only guard)", async () => {
    setupOk()
    mistralMock.mistralStream.mockImplementation(async (opts: any) => {
      opts.onContent?.("Looks good.")
      return { role: "assistant", content: "Looks good.", tool_calls: [], finish_reason: "stop" }
    })
    const res = await POST(
      makeRequest({ message: "review", subjectType: "post", subjectKey: "post-1", draft: DRAFT, reviewMode: "prose", scope: "full" })
    )
    const events = await drainSSE(res)
    expect(events.find((e) => e.type === "terminal_expected")).toBeFalsy()
  })
})