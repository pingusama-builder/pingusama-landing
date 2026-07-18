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
    { id: "m1", role: "user", content: "hi", created_at: "2026-07-17T00:00:05Z", model: null, tool_calls: null, reasoning: null, telemetry: null, web_research: null },
    {
      id: "m2", role: "assistant", content: "hello", created_at: "2026-07-17T00:00:06Z", model: "mistral-medium-3-5",
      tool_calls: [{ id: "c1", type: "function", function: { name: "save_memory", arguments: "{\"type\":\"user\"}" } }],
      reasoning: "thinking…",
      telemetry: { response_model: "mistral-medium-3-5", reasoning_effort_sent: "high", reasoning_chars: 9, text_chars: 5, finish_reason: "stop", content_chunk_types: ["thinking", "text"] },
      web_research: null,
    },
    { id: "m3", role: "tool", content: "saved", created_at: "2026-07-17T00:00:07Z", model: null, tool_calls: { tool_call_id: "c1", name: "save_memory" }, reasoning: null, telemetry: null, web_research: null },
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

  it("omits the Reasoning block and Telemetry line for an assistant turn with null fields", () => {
    const logWithNullAssistant: CompanionDebugLog = {
      thread: log.thread,
      exportedAt: log.exportedAt,
      messages: [
        ...log.messages,
        {
          id: "m9", role: "assistant", content: "ok", created_at: "2026-07-17T00:00:09Z",
          model: "mistral-medium-latest", tool_calls: null, reasoning: null, telemetry: null, web_research: null,
        },
      ],
    }
    const md = debugLogToMarkdown(logWithNullAssistant)
    const assistantSection = md.split("## [assistant] · 2026-07-17T00:00:09Z")[1]?.split("---")[0] ?? ""
    expect(assistantSection).toContain("ok")
    expect(assistantSection).not.toContain("### Reasoning")
    expect(assistantSection).not.toContain("**Telemetry:**")
    expect(assistantSection).not.toContain("### Web research")
  })

  it("renders a Web research block on an assistant turn with a pipeline + tool run", () => {
    const logWithWeb: CompanionDebugLog = {
      thread: log.thread,
      exportedAt: log.exportedAt,
      messages: [
        ...log.messages,
        {
          id: "m10", role: "assistant", content: "Fan Zhendong signed with Borussia Düsseldorf.", created_at: "2026-07-17T00:00:10Z",
          model: "mistral-medium-3-5", tool_calls: null, reasoning: null, telemetry: null,
          web_research: {
            schemaVersion: 1,
            availableToAssistantMessage: true,
            runs: [
              {
                via: "pipeline", mode: "auto", decision: "search", decisionVia: "heuristic",
                queries: ["Fan Zhendong 2026", "Fan Zhendong Borussia Düsseldorf"],
                subject: "Fan Zhendong", subjectMatch: true, guard: "none",
                sources: [
                  { url: "https://chinadaily.com/x", title: "China Daily", snippet: "Fan Zhendong will miss…", readFull: false },
                  { url: "https://ettu.org/y", title: "ETTU", snippet: "Borussia Düsseldorf signed FAN Zhendong…", readFull: true },
                ],
                pages: [{ url: "https://ettu.org/y", extractedText: "Borussia Düsseldorf have announced…", charsOriginal: 2100, truncated: false }],
                evidenceInjected: "[PUBLIC WEB EVIDENCE]…", evidenceChars: 1800,
                effort: "high", maxTokens: 8000, searchedAt: "2026-07-18T06:15:30Z",
              },
              {
                via: "tool", mode: "tool",
                queries: ["Fan Zhendong 2026 roster"], subject: "Fan Zhendong", subjectMatch: true, guard: "none",
                sources: [{ url: "https://tabletennisdaily.com/z", title: "TableTennisDaily", snippet: "Fan to join Borussia…", readFull: false }],
                pages: [], evidenceInjected: "[EVIDENCE]…", evidenceChars: 400,
                effort: null, maxTokens: null, searchedAt: "2026-07-18T06:15:45Z",
              },
            ],
          },
        },
      ],
    }
    const md = debugLogToMarkdown(logWithWeb)
    const section = md.split("## [assistant] · 2026-07-17T00:00:10Z")[1]?.split("---")[0] ?? ""
    expect(section).toContain("### Web research")
    // Pipeline run header with decision provenance.
    expect(section).toContain("via: pipeline, mode: auto, decision: search, via heuristic")
    expect(section).toContain('queries: ["Fan Zhendong 2026","Fan Zhendong Borussia Düsseldorf"]')
    expect(section).toContain("subject: Fan Zhendong (match: true)")
    expect(section).toContain("guard: none")
    expect(section).toContain("sources: 2 (1 read in full)")
    expect(section).toContain("https://ettu.org/y — ETTU [read in full]")
    expect(section).toContain("https://chinadaily.com/x — China Daily [snippet]")
    expect(section).toContain("pages extracted: 1")
    expect(section).toContain("effort: high, maxTokens: 8000, evidence injected: 1800 chars")
    // Tool run header (no decision field on a follow-up tool call).
    expect(section).toContain("via: tool, mode: tool")
    expect(section).toContain("https://tabletennisdaily.com/z — TableTennisDaily [snippet]")
  })

  it("omits the Web research block when web_research is null or has no runs", () => {
    const logEmpty: CompanionDebugLog = {
      thread: log.thread,
      exportedAt: log.exportedAt,
      messages: [
        ...log.messages,
        {
          id: "m11", role: "assistant", content: "ok", created_at: "2026-07-17T00:00:11Z",
          model: "mistral-medium-latest", tool_calls: null, reasoning: null, telemetry: null,
          web_research: { schemaVersion: 1, availableToAssistantMessage: true, runs: [] },
        },
      ],
    }
    const md = debugLogToMarkdown(logEmpty)
    const section = md.split("## [assistant] · 2026-07-17T00:00:11Z")[1]?.split("---")[0] ?? ""
    expect(section).not.toContain("### Web research")
  })
})
