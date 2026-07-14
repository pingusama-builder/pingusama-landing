import { describe, it, expect } from "vitest"
import { rowToMistral } from "@/lib/chat/messages"
import type { ChatMessageRow } from "@/lib/db/chat"

function makeRow(over: Partial<ChatMessageRow> & Pick<ChatMessageRow, "role">): ChatMessageRow {
  return {
    id: "m1",
    thread_id: "t1",
    content: null,
    tool_calls: null,
    model: null,
    created_at: "2026-07-11",
    ...over,
  } as ChatMessageRow
}

describe("rowToMistral", () => {
  it("maps a user row to a user message", () => {
    const row = makeRow({ role: "user", content: "hi" })
    expect(rowToMistral(row)).toEqual({ role: "user", content: "hi" })
  })

  it("uses an empty string when a user row has null content", () => {
    const row = makeRow({ role: "user", content: null })
    expect(rowToMistral(row)).toEqual({ role: "user", content: "" })
  })

  it("maps an assistant row with content", () => {
    const row = makeRow({ role: "assistant", content: "hello" })
    expect(rowToMistral(row)).toEqual({ role: "assistant", content: "hello" })
  })

  it("maps an assistant row with tool_calls and null content", () => {
    const row = makeRow({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "save_memory", arguments: "{}" } }],
    })
    expect(rowToMistral(row)).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "save_memory", arguments: "{}" } }],
    })
  })

  it("drops a degenerate assistant row with no content and no tool_calls", () => {
    const row = makeRow({ role: "assistant", content: null, tool_calls: null })
    expect(rowToMistral(row)).toBeNull()
  })

  it("drops a degenerate assistant row with empty content and no tool_calls", () => {
    const row = makeRow({ role: "assistant", content: "", tool_calls: null })
    expect(rowToMistral(row)).toBeNull()
  })

  it("maps a tool row using the stored tool_call_id", () => {
    const row = makeRow({
      role: "tool",
      content: "saved",
      tool_calls: { tool_call_id: "call_1", name: "save_memory" },
    })
    expect(rowToMistral(row)).toEqual({
      role: "tool",
      content: "saved",
      tool_call_id: "call_1",
    })
  })

  it("falls back to an empty tool_call_id when a tool row lacks one", () => {
    const row = makeRow({ role: "tool", content: "saved", tool_calls: null })
    expect(rowToMistral(row)).toEqual({ role: "tool", content: "saved", tool_call_id: "" })
  })
})
