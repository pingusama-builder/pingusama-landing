import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the Mistral client — capture the two passes' return values.
const mistralMock = vi.hoisted(() => ({ turn: vi.fn() }))
vi.mock("@/lib/chat/mistral", () => ({ mistralTurn: mistralMock.turn }))

// Mock the data layer — track saves + stamps.
const dbMock = vi.hoisted(() => ({
  getMessages: vi.fn(),
  listAllMemories: vi.fn(),
  recallMemories: vi.fn(),
  saveMemory: vi.fn(),
  touchInferredAt: vi.fn(),
  assertMemoryInput: vi.fn(),
  assertPersonalName: vi.fn(),
}))
vi.mock("@/lib/db/chat", () => ({
  getMessages: dbMock.getMessages,
  listAllMemories: dbMock.listAllMemories,
  recallMemories: dbMock.recallMemories,
  saveMemory: dbMock.saveMemory,
  touchInferredAt: dbMock.touchInferredAt,
  assertMemoryInput: dbMock.assertMemoryInput,
  assertPersonalName: dbMock.assertPersonalName,
}))
vi.mock("@/lib/chat/models", () => ({ MODEL_TIERS: { small: "s", medium: "m", large: "mistral-large-latest" } }))

import { inferMemoriesFromThread } from "@/lib/chat/infer"

const msg = (role: "user" | "assistant" | "tool", content: string) =>
  ({ id: `${role}-${content.slice(0,4)}`, thread_id: "t1", role, content, tool_calls: null, model: null, created_at: "x" })

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.listAllMemories.mockResolvedValue([])
  dbMock.recallMemories.mockResolvedValue([])
  dbMock.assertMemoryInput.mockImplementation(() => {})
  dbMock.assertPersonalName.mockImplementation(() => {})
})

describe("inferMemoriesFromThread", () => {
  it("saves only verdict=keep entries from pass 2", async () => {
    dbMock.getMessages.mockResolvedValue([
      msg("user", "I really like terracotta accents everywhere"),
      msg("assistant", "Got it, I'll remember that."),
    ])
    // pass 1: two raw candidates
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "prefers-terracotta", description: "d", content: "c" },
      { type: "idea", name: "transient-thought", description: "d", content: "c" },
    ]), tool_calls: [], finish_reason: "stop" })
    // pass 2: keep first, drop second
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "prefers-terracotta", description: "d", content: "c", verdict: "keep", reason: "durable" },
      { type: "idea", name: "transient-thought", description: "d", content: "c", verdict: "drop", reason: "transient" },
    ]), tool_calls: [], finish_reason: "stop" })
    dbMock.saveMemory.mockImplementation(async (input: any) => ({ name: input.name, type: input.type }))

    const summary = await inferMemoriesFromThread("t1")

    expect(summary.saved).toEqual([{ name: "prefers-terracotta", type: "user" }])
    expect(summary.dropped).toBe(1)
    expect(summary.skipped).toBe(0)
    expect(dbMock.saveMemory).toHaveBeenCalledTimes(1)
    expect(dbMock.saveMemory.mock.calls[0][0]).toMatchObject({ source: "inference", sourceThreadId: "t1" })
    expect(dbMock.touchInferredAt).toHaveBeenCalledWith("t1")
  })

  it("skips (does not save) entries that fail assertPersonalName (site:* guard)", async () => {
    dbMock.getMessages.mockResolvedValue([
      msg("user", "hello there"),
      msg("assistant", "hi"),
    ])
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "site:blog", description: "d", content: "c" },
    ]), tool_calls: [], finish_reason: "stop" })
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "site:blog", description: "d", content: "c", verdict: "keep", reason: "x" },
    ]), tool_calls: [], finish_reason: "stop" })
    // assertPersonalName throws for site:*
    dbMock.assertPersonalName.mockImplementation(() => { throw new Error("managed by refresh_awareness") })
    dbMock.saveMemory.mockResolvedValue({ name: "should-not-happen", type: "user" })

    const summary = await inferMemoriesFromThread("t1")
    expect(summary.saved).toEqual([])
    expect(summary.skipped).toBe(1)
    expect(dbMock.saveMemory).not.toHaveBeenCalled()
  })

  it("returns an empty summary without calling Mistral when the transcript is too short", async () => {
    dbMock.getMessages.mockResolvedValue([msg("user", "hi")]) // only 1 non-tool message
    const summary = await inferMemoriesFromThread("t1")
    expect(summary.saved).toEqual([])
    expect(summary.dropped).toBe(0)
    expect(mistralMock.turn).not.toHaveBeenCalled()
    expect(dbMock.touchInferredAt).toHaveBeenCalledWith("t1")
  })

  it("returns an empty summary when pass 1 yields no candidates", async () => {
    dbMock.getMessages.mockResolvedValue([
      msg("user", "what is 2+2"),
      msg("assistant", "4"),
    ])
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: "[]", tool_calls: [], finish_reason: "stop" })
    const summary = await inferMemoriesFromThread("t1")
    expect(summary.saved).toEqual([])
    expect(mistralMock.turn).toHaveBeenCalledTimes(1) // pass 2 never runs
  })

  it("handles malformed pass-2 JSON (no throw, all skipped)", async () => {
    dbMock.getMessages.mockResolvedValue([
      msg("user", "I like terracotta accents"),
      msg("assistant", "noted"),
    ])
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "prefers-terracotta", description: "d", content: "c" },
    ]), tool_calls: [], finish_reason: "stop" })
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: "sorry, I can't do JSON", tool_calls: [], finish_reason: "stop" })
    const summary = await inferMemoriesFromThread("t1")
    expect(summary.saved).toEqual([])
    expect(summary.skipped).toBe(0) // nothing to skip — parsed array was empty
    expect(summary.dropped).toBe(0)
    expect(dbMock.touchInferredAt).toHaveBeenCalledWith("t1")
  })

  it("dedupes by name via saveMemory upsert (two keeps with the same name save once each but the bank dedupes)", async () => {
    dbMock.getMessages.mockResolvedValue([
      msg("user", "I like terracotta accents"),
      msg("assistant", "noted"),
    ])
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "prefers-terracotta", description: "d", content: "c" },
    ]), tool_calls: [], finish_reason: "stop" })
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: JSON.stringify([
      { type: "user", name: "prefers-terracotta", description: "d", content: "c", verdict: "keep", reason: "x" },
      { type: "user", name: "prefers-terracotta", description: "d2", content: "c2", verdict: "keep", reason: "refine" },
    ]), tool_calls: [], finish_reason: "stop" })
    dbMock.saveMemory.mockImplementation(async (input: any) => ({ name: input.name, type: input.type }))
    const summary = await inferMemoriesFromThread("t1")
    // Both keeps are attempted (the bank's upsert-by-name dedupes); both reported.
    expect(summary.saved).toHaveLength(2)
    expect(dbMock.saveMemory).toHaveBeenCalledTimes(2)
  })
})