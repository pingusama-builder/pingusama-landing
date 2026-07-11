import { describe, it, expect } from "vitest"
import { appendAssistantDelta } from "@/lib/chat/stream-updater"

type Line = { role: "user" | "assistant" | "tool"; text: string }

describe("appendAssistantDelta", () => {
  it("appends a delta to the last assistant line", () => {
    const lines: Line[] = [{ role: "assistant", text: "Hello" }]
    const next = appendAssistantDelta(lines, "text", " there")
    expect(next[next.length - 1].text).toBe("Hello there")
  })

  it("does not mutate the input array or its elements (pure)", () => {
    const lines: Line[] = [{ role: "assistant", text: "Hello" }]
    appendAssistantDelta(lines, "text", "!")
    expect(lines[0].text).toBe("Hello") // input element untouched
    expect(lines).toHaveLength(1) // input array length untouched
  })

  it("is idempotent under StrictMode double-invoke — delta appended once, not twice", () => {
    const prev: Line[] = [{ role: "assistant", text: "F" }]
    // React StrictMode calls a state updater twice, BOTH times with the same
    // `prev`. A pure updater yields the same result from the same input, so the
    // second call must NOT accumulate a second delta. An impure updater that
    // does `last.text += delta` on a shallow-copied array mutates the shared
    // last element on the first call and appends AGAIN on the second →
    // "FINDINGSINDINGS" in the transcript.
    const first = appendAssistantDelta(prev, "text", "INDINGS")
    const second = appendAssistantDelta(prev, "text", "INDINGS")
    expect(second[second.length - 1].text).toBe("FINDINGS")
    expect(first).toEqual(second)
    // The shared input must still be untouched after both invokes.
    expect(prev[0].text).toBe("F")
  })

  it("leaves a non-assistant last line unchanged (returns same reference)", () => {
    const lines: Line[] = [{ role: "user", text: "hi" }]
    expect(appendAssistantDelta(lines, "text", "x")).toBe(lines)
  })

  it("works on a content-keyed shape (the chat UI's UIMessage)", () => {
    type Msg = { id: string; role: "user" | "assistant" | "tool"; content: string }
    const prev: Msg[] = [{ id: "m1", role: "assistant", content: "Hi" }]
    const next = appendAssistantDelta(prev, "content", ".")
    expect(next[next.length - 1].content).toBe("Hi.")
    expect(prev[0].content).toBe("Hi") // purity: input untouched
  })
})