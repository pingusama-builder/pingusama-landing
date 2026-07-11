import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the Mistral client — capture the two passes' return values.
const mistralMock = vi.hoisted(() => ({ turn: vi.fn() }))
vi.mock("@/lib/chat/mistral", () => ({ mistralTurn: mistralMock.turn }))

// Mock the data layer — track saves + stamps.
const dbMock = vi.hoisted(() => ({
  getMessages: vi.fn(),
  getThread: vi.fn(),
  listAllMemories: vi.fn(),
  recallMemories: vi.fn(),
  saveMemory: vi.fn(),
  touchInferredAt: vi.fn(),
  assertMemoryInput: vi.fn(),
  assertPersonalName: vi.fn(),
}))
vi.mock("@/lib/db/chat", () => ({
  getMessages: dbMock.getMessages,
  getThread: dbMock.getThread,
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

const msgAt = (role: "user" | "assistant" | "tool", content: string, created_at: string) =>
  ({ id: `${role}-${content.slice(0, 4)}`, thread_id: "t1", role, content, tool_calls: null, model: null, created_at })

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.getThread.mockResolvedValue(null)
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

describe("inferMemoriesFromThread (incremental checkpoints)", () => {
  it("sends only new messages + a recent tail to pass 1, labeled", async () => {
    dbMock.getThread.mockResolvedValue({ id: "t1", last_inferred_at: "2026-07-11T10:00:00Z" })
    dbMock.getMessages.mockResolvedValue([
      msgAt("user", "old question", "2026-07-11T09:00:00Z"),
      msgAt("assistant", "old answer", "2026-07-11T09:05:00Z"),
      msgAt("user", "I now prefer walnut accents", "2026-07-11T10:05:00Z"),
      msgAt("assistant", "noted, walnut it is", "2026-07-11T10:06:00Z"),
    ])
    // pass 1 returns no candidates so pass 2 never runs; we only assert pass-1 input.
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: "[]", tool_calls: [], finish_reason: "stop" })

    const summary = await inferMemoriesFromThread("t1")

    const pass1Content = mistralMock.turn.mock.calls[0][0].messages[1].content as string
    expect(pass1Content).toContain("New messages since last save")
    expect(pass1Content).toContain("I now prefer walnut accents")
    expect(pass1Content).toContain("Earlier conversation")
    expect(pass1Content).toContain("old question") // tail included for context
    expect(summary.scanned).toBe(2) // only the 2 new non-tool messages
    expect(summary.saved).toEqual([])
    expect(dbMock.touchInferredAt).toHaveBeenCalledWith("t1")
  })

  it("makes no Mistral call when there are no new messages since the checkpoint", async () => {
    dbMock.getThread.mockResolvedValue({ id: "t1", last_inferred_at: "2026-07-11T10:00:00Z" })
    dbMock.getMessages.mockResolvedValue([
      msgAt("user", "old question", "2026-07-11T09:00:00Z"),
      msgAt("assistant", "old answer", "2026-07-11T09:30:00Z"),
    ])
    const summary = await inferMemoriesFromThread("t1")
    expect(mistralMock.turn).not.toHaveBeenCalled()
    expect(summary.scanned).toBe(0)
    expect(summary.saved).toEqual([])
    expect(dbMock.touchInferredAt).toHaveBeenCalledWith("t1")
  })

  it("forceFull ignores the checkpoint and scans the whole transcript", async () => {
    dbMock.getThread.mockResolvedValue({ id: "t1", last_inferred_at: "2026-07-11T10:00:00Z" })
    dbMock.getMessages.mockResolvedValue([
      msgAt("user", "old question", "2026-07-11T09:00:00Z"),
      msgAt("assistant", "old answer", "2026-07-11T09:05:00Z"),
      msgAt("user", "new question", "2026-07-11T10:05:00Z"),
      msgAt("assistant", "new answer", "2026-07-11T10:06:00Z"),
    ])
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: "[]", tool_calls: [], finish_reason: "stop" })

    const summary = await inferMemoriesFromThread("t1", { forceFull: true })

    const pass1Content = mistralMock.turn.mock.calls[0][0].messages[1].content as string
    expect(pass1Content).not.toContain("New messages since last save")
    expect(pass1Content).not.toContain("Earlier conversation")
    expect(pass1Content).toContain("old question")
    expect(summary.scanned).toBe(4) // all messages
  })

  it("full path (last_inferred_at null) has no incremental labels", async () => {
    dbMock.getThread.mockResolvedValue({ id: "t1", last_inferred_at: null })
    dbMock.getMessages.mockResolvedValue([
      msgAt("user", "hello there", "2026-07-11T09:00:00Z"),
      msgAt("assistant", "hi", "2026-07-11T09:05:00Z"),
    ])
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: "[]", tool_calls: [], finish_reason: "stop" })
    await inferMemoriesFromThread("t1")
    const pass1Content = mistralMock.turn.mock.calls[0][0].messages[1].content as string
    expect(pass1Content).not.toContain("New messages since last save")
    expect(pass1Content).not.toContain("Earlier conversation")
    expect(pass1Content).toContain("hello there")
  })

  it("partitions correctly across the Z-vs-+00:00 timestamp format mismatch", async () => {
    // last_inferred_at uses Z-suffix millisecond format (touchInferredAt's toISOString);
    // created_at uses +00:00 microsecond format (Supabase/PostgREST).
    dbMock.getThread.mockResolvedValue({ id: "t1", last_inferred_at: "2026-07-11T10:00:00.123Z" })
    dbMock.getMessages.mockResolvedValue([
      msgAt("user", "old question", "2026-07-11T09:59:59.999999+00:00"),
      msgAt("assistant", "old answer", "2026-07-11T10:00:00.000000+00:00"),
      msgAt("user", "new after the stamp", "2026-07-11T10:00:00.500000+00:00"),
      msgAt("assistant", "new reply", "2026-07-11T10:00:00.600000+00:00"),
    ])
    mistralMock.turn.mockResolvedValueOnce({ role: "assistant", content: "[]", tool_calls: [], finish_reason: "stop" })
    const summary = await inferMemoriesFromThread("t1")
    const pass1Content = mistralMock.turn.mock.calls[0][0].messages[1].content as string
    expect(pass1Content).toContain("New messages since last save")
    expect(pass1Content).toContain("new after the stamp")
    // The 6-deep tail includes both prior rows as context; the new slice is the 2 newest.
    expect(pass1Content).toContain("old question") // tail context
    expect(pass1Content).toContain("old answer")   // tail context
    expect(summary.scanned).toBe(2) // only the 2 new non-tool messages
  })
})