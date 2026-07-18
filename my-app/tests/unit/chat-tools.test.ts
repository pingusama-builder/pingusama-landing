import { describe, it, expect, vi, beforeEach } from "vitest"

// Keep the real validation (assertMemoryInput / assertPersonalName) but stub the
// DB-write functions so we can assert the tool surface calls them correctly and
// enforces its caps. The awareness module is fully stubbed.
const chatMock = vi.hoisted(() => ({
  saveMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  setThreadModelPreference: vi.fn(),
  setOneTurnOverride: vi.fn(),
}))
const awarenessMock = vi.hoisted(() => ({
  refreshAwareness: vi.fn(),
  readCode: vi.fn(),
}))
const postReadMock = vi.hoisted(() => ({
  readPostForTool: vi.fn(),
}))

vi.mock("@/lib/db/chat", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/chat")>("@/lib/db/chat")
  return {
    ...actual,
    saveMemory: chatMock.saveMemory,
    updateMemory: chatMock.updateMemory,
    deleteMemory: chatMock.deleteMemory,
    setThreadModelPreference: chatMock.setThreadModelPreference,
    setOneTurnOverride: chatMock.setOneTurnOverride,
  }
})

vi.mock("@/lib/chat/awareness", () => ({
  refreshAwareness: awarenessMock.refreshAwareness,
  readCode: awarenessMock.readCode,
  // type re-exports the tool surface imports
  SiteCategory: undefined,
}))

vi.mock("@/lib/chat/post-read", () => ({
  readPostForTool: postReadMock.readPostForTool,
}))

const tavilyMock = vi.hoisted(() => ({
  searchWeb: vi.fn(),
  rankSources: vi.fn(),
  formatWebEvidenceGuarded: vi.fn(),
  subjectInSources: vi.fn(),
}))
vi.mock("@/lib/chat/tavily-search", () => ({
  searchWeb: tavilyMock.searchWeb,
  rankSources: tavilyMock.rankSources,
  formatWebEvidenceGuarded: tavilyMock.formatWebEvidenceGuarded,
  subjectInSources: tavilyMock.subjectInSources,
}))

const mistralMock = vi.hoisted(() => ({
  mistralTurn: vi.fn(),
  getReasoningModel: vi.fn(),
  reasoningEffortForModel: vi.fn(),
}))
vi.mock("@/lib/chat/mistral", async () => {
  const actual = await vi.importActual<any>("@/lib/chat/mistral")
  return {
    ...actual,
    mistralTurn: mistralMock.mistralTurn,
    getReasoningModel: mistralMock.getReasoningModel,
    reasoningEffortForModel: mistralMock.reasoningEffortForModel,
  }
})

import { executeToolCall, CHAT_TOOLS, type ToolContext } from "@/lib/chat/tools"
import type { MemoryRow } from "@/lib/db/chat"

const baseRow = (over: Partial<MemoryRow> = {}): MemoryRow => ({
  id: "r1",
  type: "user",
  name: "prefers-terracotta",
  description: "d",
  content: "c",
  links: [],
  source_thread_id: null,
  source: "chat",
  fingerprint: null,
  last_used_at: "2026-07-11T00:00:00Z",
  last_synced_at: null,
  created_at: "2026-07-11T00:00:00Z",
  updated_at: "2026-07-11T00:00:00Z",
  active: true,
  ...over,
})

function ctx(): ToolContext {
  return {
    sourceThreadId: "t1",
    memoryWrites: 0,
    maxMemoryWrites: 3,
    webTouched: false,
    webSearchCalls: 0,
    webResearch: null,
  }
}

describe("executeToolCall — save_memory", () => {
  beforeEach(() => vi.clearAllMocks())

  it("saves a valid memory and counts the write", async () => {
    chatMock.saveMemory.mockResolvedValue(baseRow({ name: "prefers-terracotta", type: "user" }))
    const c = ctx()
    const res = await executeToolCall(
      "save_memory",
      JSON.stringify({
        type: "user",
        name: "prefers-terracotta",
        description: "likes warm terracotta accents",
        content: "Prefers terracotta accents.",
      }),
      c
    )
    expect(res.memoryWrite).toBe(true)
    expect(res.content).toContain("prefers-terracotta")
    expect(c.memoryWrites).toBe(1)
    expect(chatMock.saveMemory).toHaveBeenCalledWith(
      expect.objectContaining({ name: "prefers-terracotta", sourceThreadId: "t1" })
    )
  })

  it("rejects a site:* name (the bot cannot clobber awareness)", async () => {
    const res = await executeToolCall(
      "save_memory",
      JSON.stringify({ type: "user", name: "site:blog", description: "d", content: "c" }),
      ctx()
    )
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/Tool error/i)
    expect(chatMock.saveMemory).not.toHaveBeenCalled()
  })

  it("rejects an invalid type", async () => {
    const res = await executeToolCall(
      "save_memory",
      JSON.stringify({ type: "bogus", name: "ok-name", description: "d", content: "c" }),
      ctx()
    )
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/Tool error/i)
  })

  it("skips once the per-turn write cap is reached", async () => {
    const c = ctx()
    c.memoryWrites = c.maxMemoryWrites
    const res = await executeToolCall(
      "save_memory",
      JSON.stringify({ type: "user", name: "ok-name", description: "d", content: "c" }),
      c
    )
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/cap/)
    expect(chatMock.saveMemory).not.toHaveBeenCalled()
  })

  it("handles malformed JSON args gracefully", async () => {
    const res = await executeToolCall("save_memory", "{not json", ctx())
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/Tool error/i)
  })
})

describe("executeToolCall — update / delete", () => {
  beforeEach(() => vi.clearAllMocks())
  it("updates a memory by name", async () => {
    chatMock.updateMemory.mockResolvedValue(baseRow({ name: "prefers-terracotta" }))
    const res = await executeToolCall(
      "update_memory",
      JSON.stringify({ name: "prefers-terracotta", content: "new" }),
      ctx()
    )
    expect(res.memoryWrite).toBe(true)
    expect(chatMock.updateMemory).toHaveBeenCalledWith("prefers-terracotta", {
      content: "new",
      description: undefined,
    })
  })
  it("deletes a memory by name", async () => {
    chatMock.deleteMemory.mockResolvedValue(undefined)
    const res = await executeToolCall(
      "delete_memory",
      JSON.stringify({ name: "prefers-terracotta" }),
      ctx()
    )
    expect(res.memoryWrite).toBe(true)
    expect(chatMock.deleteMemory).toHaveBeenCalledWith("prefers-terracotta")
  })
  it("delete rejects a site:* name", async () => {
    const res = await executeToolCall("delete_memory", JSON.stringify({ name: "site:blog" }), ctx())
    expect(res.memoryWrite).toBe(false)
    expect(chatMock.deleteMemory).not.toHaveBeenCalled()
  })
})

describe("executeToolCall — refresh_awareness", () => {
  beforeEach(() => vi.clearAllMocks())
  it("refreshes a single category and reports the delta", async () => {
    awarenessMock.refreshAwareness.mockResolvedValue([
      { category: "blog", changed: true, added: ["new-post"], removed: [], syncedAt: "2026-07-11" },
    ])
    const res = await executeToolCall(
      "refresh_awareness",
      JSON.stringify({ category: "blog" }),
      ctx()
    )
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toContain("blog")
    expect(res.content).toContain("new-post")
    expect(awarenessMock.refreshAwareness).toHaveBeenCalledWith({ category: "blog", sourceThreadId: "t1" })
  })
  it("rejects an invalid category", async () => {
    const res = await executeToolCall(
      "refresh_awareness",
      JSON.stringify({ category: "bogus" }),
      ctx()
    )
    expect(res.content).toMatch(/Invalid category/)
    expect(awarenessMock.refreshAwareness).not.toHaveBeenCalled()
  })
  it("refreshes all categories when none specified", async () => {
    awarenessMock.refreshAwareness.mockResolvedValue([
      { category: "blog", changed: false, added: [], removed: [], syncedAt: "x" },
      { category: "shelf", changed: false, added: [], removed: [], syncedAt: "x" },
    ])
    const res = await executeToolCall("refresh_awareness", "{}", ctx())
    expect(res.content).toContain("blog")
    expect(res.content).toContain("shelf")
    expect(awarenessMock.refreshAwareness).toHaveBeenCalledWith({ category: undefined, sourceThreadId: "t1" })
  })
})

describe("executeToolCall — read_code", () => {
  beforeEach(() => vi.clearAllMocks())
  it("looks up a feature", async () => {
    awarenessMock.readCode.mockReturnValue("Route /admin/blog ← app/admin/blog/page.tsx")
    const res = await executeToolCall("read_code", JSON.stringify({ feature: "blog" }), ctx())
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toContain("blog")
  })
  it("looks up a path", async () => {
    awarenessMock.readCode.mockReturnValue("// lib/tools.ts\nexport const TOOLS...")
    const res = await executeToolCall("read_code", JSON.stringify({ path: "lib/tools.ts" }), ctx())
    expect(awarenessMock.readCode).toHaveBeenCalledWith({ feature: undefined, path: "lib/tools.ts" })
  })
})

describe("executeToolCall — unknown tool", () => {
  it("returns an error for an unrecognized tool name", async () => {
    const res = await executeToolCall("publish_post", "{}", ctx())
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/Unknown tool/)
  })
})

describe("executeToolCall — set_model", () => {
  beforeEach(() => vi.clearAllMocks())

  it("persistently sets the thread model preference", async () => {
    chatMock.setThreadModelPreference.mockResolvedValue(undefined)
    const res = await executeToolCall(
      "set_model",
      JSON.stringify({ tier: "large", scope: "persistent" }),
      ctx()
    )
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/large/)
    expect(res.content).toMatch(/persistent/i)
    expect(chatMock.setThreadModelPreference).toHaveBeenCalledWith("t1", "large")
    expect(chatMock.setOneTurnOverride).not.toHaveBeenCalled()
  })

  it("sets a one-turn override when scope is 'turn'", async () => {
    chatMock.setOneTurnOverride.mockResolvedValue(undefined)
    const res = await executeToolCall(
      "set_model",
      JSON.stringify({ tier: "small", scope: "turn" }),
      ctx()
    )
    expect(res.memoryWrite).toBe(false)
    expect(chatMock.setOneTurnOverride).toHaveBeenCalledWith("t1", "small")
    expect(chatMock.setThreadModelPreference).not.toHaveBeenCalled()
  })

  it("defaults scope to 'persistent'", async () => {
    chatMock.setThreadModelPreference.mockResolvedValue(undefined)
    await executeToolCall("set_model", JSON.stringify({ tier: "auto" }), ctx())
    expect(chatMock.setThreadModelPreference).toHaveBeenCalledWith("t1", "auto")
  })

  it("rejects an invalid tier (no throw, no DB write)", async () => {
    const res = await executeToolCall("set_model", JSON.stringify({ tier: "enormous" }), ctx())
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/Tool error/i)
    expect(chatMock.setThreadModelPreference).not.toHaveBeenCalled()
    expect(chatMock.setOneTurnOverride).not.toHaveBeenCalled()
  })

  it("is not counted against the memory-write cap", async () => {
    chatMock.setThreadModelPreference.mockResolvedValue(undefined)
    const c = ctx()
    c.memoryWrites = c.maxMemoryWrites // at cap
    const res = await executeToolCall("set_model", JSON.stringify({ tier: "large" }), c)
    expect(res.memoryWrite).toBe(false)
    expect(c.memoryWrites).toBe(c.maxMemoryWrites) // unchanged
    expect(chatMock.setThreadModelPreference).toHaveBeenCalled()
  })
})

describe("executeToolCall — shared mutation cap (bug fix)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("counts update_memory against the cap and refuses once reached", async () => {
    chatMock.updateMemory.mockResolvedValue(baseRow({ name: "n" }))
    const c = ctx()
    c.memoryWrites = c.maxMemoryWrites
    const res = await executeToolCall(
      "update_memory",
      JSON.stringify({ name: "n", content: "x" }),
      c
    )
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/cap/)
    expect(chatMock.updateMemory).not.toHaveBeenCalled()
  })

  it("increments the cap on a successful update_memory", async () => {
    chatMock.updateMemory.mockResolvedValue(baseRow({ name: "n" }))
    const c = ctx()
    await executeToolCall("update_memory", JSON.stringify({ name: "n", content: "x" }), c)
    expect(c.memoryWrites).toBe(1)
  })

  it("counts delete_memory against the cap and refuses once reached", async () => {
    const c = ctx()
    c.memoryWrites = c.maxMemoryWrites
    const res = await executeToolCall("delete_memory", JSON.stringify({ name: "n" }), c)
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/cap/)
    expect(chatMock.deleteMemory).not.toHaveBeenCalled()
  })

  it("increments the cap on a successful delete_memory", async () => {
    chatMock.deleteMemory.mockResolvedValue(undefined)
    const c = ctx()
    await executeToolCall("delete_memory", JSON.stringify({ name: "n" }), c)
    expect(c.memoryWrites).toBe(1)
  })

  it("after N saves, an update_memory is refused (shared cap)", async () => {
    chatMock.saveMemory.mockResolvedValue(baseRow({ name: "a" }))
    chatMock.updateMemory.mockResolvedValue(baseRow({ name: "a" }))
    const c = ctx()
    await executeToolCall(
      "save_memory",
      JSON.stringify({ type: "user", name: "a", description: "d", content: "c" }),
      c
    )
    await executeToolCall(
      "save_memory",
      JSON.stringify({ type: "user", name: "b", description: "d", content: "c" }),
      c
    )
    await executeToolCall(
      "save_memory",
      JSON.stringify({ type: "user", name: "c", description: "d", content: "c" }),
      c
    )
    expect(c.memoryWrites).toBe(3)
    const res = await executeToolCall(
      "update_memory",
      JSON.stringify({ name: "a", content: "x" }),
      c
    )
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/cap/)
    expect(chatMock.updateMemory).not.toHaveBeenCalled()
  })
})
describe("executeToolCall — web_search", () => {
  beforeEach(() => vi.clearAllMocks())

  it("is registered in the tool surface", () => {
    expect(CHAT_TOOLS.some((t) => t.function.name === "web_search")).toBe(true)
  })

  it("runs a snippet-only search and returns guarded evidence (1st call)", async () => {
    const sources = [
      { title: "T", url: "https://e.com/dan-koe", domain: "e.com", snippet: "Dan Koe AI" },
    ]
    tavilyMock.searchWeb.mockResolvedValue({
      provider: "tavily",
      query: "Dan Koe AI",
      searchedAt: "x",
      sources,
    })
    tavilyMock.rankSources.mockImplementation((s: unknown[]) => s)
    tavilyMock.formatWebEvidenceGuarded.mockReturnValue("[EVIDENCE] Dan Koe …")
    tavilyMock.subjectInSources.mockReturnValue(true)
    const c: ToolContext = {
      sourceThreadId: "t1",
      memoryWrites: 0,
      maxMemoryWrites: 3,
      webTouched: true,
      webSearchCalls: 0,
      webResearch: null,
    }
    const res = await executeToolCall(
      "web_search",
      JSON.stringify({ query: "Dan Koe AI", subject: "Dan Koe" }),
      c
    )
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toContain("[EVIDENCE]")
    expect(tavilyMock.searchWeb).toHaveBeenCalledWith("Dan Koe AI", {
      maxResults: 8,
    })
    expect(c.webSearchCalls).toBe(1)
    expect(c.webTouched).toBe(true)
    expect(c.webResearch).not.toBeNull()
    expect(c.webResearch!.topSourceUrl).toBe("https://e.com/dan-koe")
  })

  it("refuses a 2nd follow-up with a nudge (cap = 1)", async () => {
    const c: ToolContext = {
      sourceThreadId: "t1",
      memoryWrites: 0,
      maxMemoryWrites: 3,
      webTouched: true,
      webSearchCalls: 1,
      webResearch: null,
    }
    const res = await executeToolCall(
      "web_search",
      JSON.stringify({ query: "again" }),
      c
    )
    expect(res.content).toMatch(/cap reached/i)
    expect(c.webSearchCalls).toBe(1)
    expect(tavilyMock.searchWeb).not.toHaveBeenCalled()
  })

  it("rejects an empty query", async () => {
    const c: ToolContext = {
      sourceThreadId: "t1",
      memoryWrites: 0,
      maxMemoryWrites: 3,
      webTouched: false,
      webSearchCalls: 0,
      webResearch: null,
    }
    const res = await executeToolCall("web_search", JSON.stringify({ query: "  " }), c)
    expect(res.content).toMatch(/non-empty query/i)
    expect(c.webSearchCalls).toBe(0)
  })
})

describe("executeToolCall — web→memory gate", () => {
  beforeEach(() => vi.clearAllMocks())

  function webCtx(
    over: Partial<import("@/lib/chat/tools").WebResearchSnapshot> = {}
  ): ToolContext {
    return {
      sourceThreadId: "t1",
      memoryWrites: 0,
      maxMemoryWrites: 3,
      webTouched: true,
      webSearchCalls: 1,
      webResearch: {
        subjectMatch: true,
        subjectMentioningSources: 2,
        hadReadInFull: true,
        topSourceUrl: "https://e.com/dan-koe",
        ...over,
      },
    }
  }

  it("refuses a web save when subjectMatch is false", async () => {
    const c = webCtx({ subjectMatch: false })
    const res = await executeToolCall(
      "save_memory",
      JSON.stringify({ type: "user", name: "dan-koe-ai", description: "d", content: "Dan Koe said X" }),
      c
    )
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/subject/i)
    expect(chatMock.saveMemory).not.toHaveBeenCalled()
    expect(mistralMock.mistralTurn).not.toHaveBeenCalled()
  })

  it("refuses a web save when corroboration is thin (<2 sources, no read-in-full)", async () => {
    const c = webCtx({ subjectMatch: true, subjectMentioningSources: 1, hadReadInFull: false })
    const res = await executeToolCall(
      "save_memory",
      JSON.stringify({ type: "user", name: "x", description: "d", content: "c" }),
      c
    )
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/corroboration/i)
    expect(chatMock.saveMemory).not.toHaveBeenCalled()
    expect(mistralMock.mistralTurn).not.toHaveBeenCalled()
  })

  it("passes the reasoning gate (save=true) → commits with source='web' + provenance URL in content", async () => {
    mistralMock.getReasoningModel.mockReturnValue("mistral-medium-3-5")
    mistralMock.reasoningEffortForModel.mockReturnValue("high")
    mistralMock.mistralTurn.mockResolvedValue({
      content: '{"save":true,"reason":"corroborated"}',
      tool_calls: [],
    })
    chatMock.saveMemory.mockResolvedValue(baseRow({ name: "dan-koe-ai", type: "user" }))
    const c = webCtx()
    const res = await executeToolCall(
      "save_memory",
      JSON.stringify({ type: "user", name: "dan-koe-ai", description: "d", content: "Dan Koe said AI matters." }),
      c
    )
    expect(res.memoryWrite).toBe(true)
    expect(chatMock.saveMemory).toHaveBeenCalledWith(expect.objectContaining({ source: "web" }))
    const savedArg = chatMock.saveMemory.mock.calls[0][0] as { content: string }
    expect(savedArg.content).toContain("https://e.com/dan-koe")
    expect(mistralMock.mistralTurn).toHaveBeenCalledTimes(1)
  })

  it("refuses when the reasoning gate returns save=false", async () => {
    mistralMock.getReasoningModel.mockReturnValue("mistral-medium-3-5")
    mistralMock.reasoningEffortForModel.mockReturnValue("high")
    mistralMock.mistralTurn.mockResolvedValue({
      content: '{"save":false,"reason":"single unverified source"}',
      tool_calls: [],
    })
    const c = webCtx()
    const res = await executeToolCall(
      "save_memory",
      JSON.stringify({ type: "user", name: "x", description: "d", content: "c" }),
      c
    )
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toMatch(/single unverified source|reason/i)
    expect(chatMock.saveMemory).not.toHaveBeenCalled()
  })

  it("a NON-web save is untouched by the gate", async () => {
    chatMock.saveMemory.mockResolvedValue(baseRow({ name: "prefers-walnut", type: "user" }))
    const c: ToolContext = {
      sourceThreadId: "t1",
      memoryWrites: 0,
      maxMemoryWrites: 3,
      webTouched: false,
      webSearchCalls: 0,
      webResearch: null,
    }
    const res = await executeToolCall(
      "save_memory",
      JSON.stringify({ type: "user", name: "prefers-walnut", description: "d", content: "Prefers walnut." }),
      c
    )
    expect(res.memoryWrite).toBe(true)
    expect(mistralMock.mistralTurn).not.toHaveBeenCalled()
    const savedArg = chatMock.saveMemory.mock.calls[0][0] as { source?: string }
    expect(savedArg.source).toBe("chat") // non-web save defaults to 'chat', never 'web'
  })
})

describe("executeToolCall — read_post", () => {
  beforeEach(() => vi.clearAllMocks())

  it("is registered in the tool surface", () => {
    expect(CHAT_TOOLS.some((t) => t.function.name === "read_post")).toBe(true)
  })

  it("reads the newest post when no slug is given", async () => {
    postReadMock.readPostForTool.mockResolvedValue("**GEI**\nSlug: gei\n\nBody.")
    const res = await executeToolCall("read_post", "{}", ctx())
    expect(res.memoryWrite).toBe(false)
    expect(res.content).toContain("GEI")
    expect(postReadMock.readPostForTool).toHaveBeenCalledWith({ slug: undefined })
  })

  it("reads a specific post by slug", async () => {
    postReadMock.readPostForTool.mockResolvedValue("**Dear Matt Haig**\nSlug: matt-haig")
    const res = await executeToolCall(
      "read_post",
      JSON.stringify({ slug: "matt-haig" }),
      ctx()
    )
    expect(res.memoryWrite).toBe(false)
    expect(postReadMock.readPostForTool).toHaveBeenCalledWith({ slug: "matt-haig" })
  })

  it("is not counted against the memory-write cap (read-only)", async () => {
    postReadMock.readPostForTool.mockResolvedValue("body")
    const c = ctx()
    c.memoryWrites = c.maxMemoryWrites
    const res = await executeToolCall("read_post", "{}", c)
    expect(res.memoryWrite).toBe(false)
    expect(c.memoryWrites).toBe(c.maxMemoryWrites) // unchanged
    expect(postReadMock.readPostForTool).toHaveBeenCalled()
  })
})
