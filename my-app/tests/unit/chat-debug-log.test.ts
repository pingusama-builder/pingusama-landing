import { describe, it, expect } from "vitest"
import { debugLogToMarkdown } from "@/lib/chat/debug-log"
import type { CompanionDebugLog } from "@/lib/db/chat"

const log: CompanionDebugLog = {
  thread: {
    id: "t1",
    title: "Hi",
    created_at: "2026-07-17T00:00:00Z",
    updated_at: "2026-07-17T01:00:00Z",
    model_preference: "auto",
  },
  exportedAt: "2026-07-17T02:00:00Z",
  messages: [
    { id: "m1", role: "user", content: "hi", created_at: "2026-07-17T00:00:05Z", model: null, tool_calls: null, reasoning: null, telemetry: null },
    {
      id: "m2", role: "assistant", content: "hello", created_at: "2026-07-17T00:00:06Z", model: "mistral-medium-3-5",
      tool_calls: [{ id: "c1", type: "function", function: { name: "save_memory", arguments: "{\"type\":\"user\"}" } }],
      reasoning: "thinking…",
      telemetry: { response_model: "mistral-medium-3-5", reasoning_effort_sent: "high", reasoning_chars: 9, text_chars: 5, finish_reason: "stop", content_chunk_types: ["thinking", "text"] },
    },
    { id: "m3", role: "tool", content: "saved", created_at: "2026-07-17T00:00:07Z", model: null, tool_calls: { tool_call_id: "c1", name: "save_memory" }, reasoning: null, telemetry: null },
  ],
}

describe("debugLogToMarkdown", () => {
  it("renders the thread header + exported timestamp", () => {
    const md = debugLogToMarkdown(log)
    expect(md).toContain("# Debug log — Hi")
    expect(md).toContain("Thread: t1")
    expect(md).toContain("Exported: 2026-07-17T02:00:00Z")
    expect(md).toContain("Model preference: auto")
  })

  it("renders an assistant section with telemetry, tool calls, and a Reasoning block", () => {
    const md = debugLogToMarkdown(log)
    expect(md).toContain("## [assistant] · 2026-07-17T00:00:06Z · model: mistral-medium-3-5")
    expect(md).toContain("**Telemetry:** response_model=mistral-medium-3-5, reasoning_effort=high, reasoning_chars=9, text_chars=5, finish_reason=stop, chunk_types=[thinking,text]")
    expect(md).toContain("**Tool calls:**")
    expect(md).toContain("- save_memory(")
    expect(md).toContain("### Reasoning")
    expect(md).toContain("thinking…")
  })

  it("renders a tool section with the tool name", () => {
    const md = debugLogToMarkdown(log)
    expect(md).toContain("## [tool] · 2026-07-17T00:00:07Z · tool: save_memory")
    expect(md).toContain("saved")
  })

  it("omits the Reasoning block and Telemetry line when absent", () => {
    const md = debugLogToMarkdown(log)
    const userSection = md.split("## [user]")[1]?.split("---")[0] ?? ""
    expect(userSection).not.toContain("### Reasoning")
    expect(userSection).not.toContain("**Telemetry:**")
  })
})