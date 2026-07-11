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

import { executeToolCall, type ToolContext } from "@/lib/chat/tools"
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
  return { sourceThreadId: "t1", memoryWrites: 0, maxMemoryWrites: 3 }
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