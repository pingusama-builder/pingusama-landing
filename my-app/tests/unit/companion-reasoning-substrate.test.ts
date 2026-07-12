import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  extractTextContent,
  isReasoningModel,
  getReasoningEffort,
} from "@/lib/chat/mistral"

const mistralSrc = readFileSync(
  fileURLToPath(new URL("../../lib/chat/mistral.ts", import.meta.url)),
  "utf8"
)

const modelsSrc = readFileSync(
  fileURLToPath(new URL("../../lib/chat/models.ts", import.meta.url)),
  "utf8"
)

// Reasoning model id the companion pins the full-review tier to when
// COMPANION_REASONING_EFFORT is set (advisor phase B8 Q7 substrate-check
// extension — Mistral in-place reasoning, option 2 Path A). See
// ai-advisor/refinement-03-fiction-examples-extension/eval/lane-decision-research.md.
const REASONING_MODEL = "mistral-medium-3-5"

describe("Mistral reasoning substrate — thinking-leak guard (safety-critical)", () => {
  // The decisive finding from the Mistral reasoning docs: when reasoning_effort
  // is "high", reasoning is embedded INSIDE delta.content as typed chunks
  // (ThinkChunk type:"thinking" + TextChunk type:"text"), NOT a separate
  // reasoning_content field. A naive `content += delta.content` would coerce a
  // chunk-array to a string and stream the model's internal reasoning to the
  // author-facing SSE. The parser must extract only text chunks and ignore
  // thinking, never leaking reasoning regardless of shape.

  it("extracts plain-string content unchanged (non-reasoning + answer phase)", () => {
    expect(extractTextContent("hello")).toBe("hello")
    expect(extractTextContent("")).toBe("")
    expect(extractTextContent(null)).toBe("")
    expect(extractTextContent(undefined)).toBe("")
  })

  it("extracts TextChunk text from a chunk array and drops ThinkChunk reasoning", () => {
    const delta = [
      { type: "thinking", thinking: [{ type: "text", text: "SECRET INTERNAL REASONING" }] },
      { type: "text", text: "answer to author" },
    ]
    expect(extractTextContent(delta)).toBe("answer to author")
  })

  it("emits ONLY text from a mixed chunk array (thinking never appears in output)", () => {
    const delta = [
      { type: "text", text: "Finding 1: " },
      { type: "thinking", thinking: [{ type: "text", text: "LEAKED THINKING" }] },
      { type: "text", text: "voice is intentional." },
    ]
    const out = extractTextContent(delta)
    expect(out).toBe("Finding 1: voice is intentional.")
    expect(out).not.toContain("LEAKED THINKING")
  })

  it("drops unknown chunk shapes rather than leak them (default to safe-empty)", () => {
    // Unknown shapes → no output (a visible empty-output failure we can catch
    // in a live trace) rather than risk stringifying reasoning to the author.
    expect(extractTextContent([{ type: "unknown", payload: "x" }])).toBe("")
    expect(extractTextContent([{ weird: 123 }])).toBe("")
    expect(extractTextContent([42, { foo: "bar" }])).toBe("")
  })

  it("handles a plain-string element inside an array", () => {
    expect(extractTextContent(["just text"])).toBe("just text")
  })
})

describe("Mistral reasoning substrate — env-gating (dormant when unset)", () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    saved.COMPANION_REASONING_EFFORT = process.env.COMPANION_REASONING_EFFORT
    saved.MISTRAL_REASONING_MODEL = process.env.MISTRAL_REASONING_MODEL
    saved.OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL
    delete process.env.COMPANION_REASONING_EFFORT
    delete process.env.MISTRAL_REASONING_MODEL
    delete process.env.OLLAMA_BASE_URL
  })

  afterEach(() => {
    process.env.COMPANION_REASONING_EFFORT = saved.COMPANION_REASONING_EFFORT
    process.env.MISTRAL_REASONING_MODEL = saved.MISTRAL_REASONING_MODEL
    process.env.OLLAMA_BASE_URL = saved.OLLAMA_BASE_URL
  })

  it("is dormant when COMPANION_REASONING_EFFORT is unset (no model is a reasoning model)", () => {
    expect(getReasoningEffort()).toBeUndefined()
    expect(isReasoningModel("mistral-medium-3-5")).toBe(false)
    expect(isReasoningModel("mistral-large-latest")).toBe(false)
  })

  it("treats only the pinned reasoning model as reasoning-capable when the env is set", () => {
    process.env.COMPANION_REASONING_EFFORT = "high"
    expect(getReasoningEffort()).toBe("high")
    expect(isReasoningModel(REASONING_MODEL)).toBe(true)
    // medium-latest / large-latest reject reasoning_effort → must NOT be flagged.
    expect(isReasoningModel("mistral-medium-latest")).toBe(false)
    expect(isReasoningModel("mistral-large-latest")).toBe(false)
  })

  it("honors an explicit MISTRAL_REASONING_MODEL override", () => {
    process.env.COMPANION_REASONING_EFFORT = "high"
    process.env.MISTRAL_REASONING_MODEL = "mistral-small-latest"
    expect(isReasoningModel("mistral-small-latest")).toBe(true)
    expect(isReasoningModel(REASONING_MODEL)).toBe(false)
  })

  it("never reports a reasoning model on the Ollama substrate (Ollama wins)", () => {
    process.env.COMPANION_REASONING_EFFORT = "high"
    process.env.OLLAMA_BASE_URL = "http://localhost:11434"
    expect(isReasoningModel(REASONING_MODEL)).toBe(false)
  })
})

describe("Mistral reasoning substrate — source wiring (covers)", () => {
  it("sends reasoning_effort as a root-level body param, gated on the reasoning model", () => {
    expect(mistralSrc).toContain("reasoning_effort")
    expect(mistralSrc).toContain("isReasoningModel")
    expect(mistralSrc).toContain("getReasoningEffort")
  })

  it("the large/review tier is rerouted to the reasoning model in models.ts", () => {
    expect(modelsSrc).toContain("COMPANION_REASONING_EFFORT")
    expect(modelsSrc).toContain("MISTRAL_REASONING_MODEL")
    expect(modelsSrc).toContain("mistral-medium-3-5")
  })

  it("the parser routes delta.content through extractTextContent (no raw += leak path)", () => {
    expect(mistralSrc).toContain("extractTextContent")
    // The old leak shape (content += delta.content with delta.content possibly an
    // array) must be gone from the streaming path.
    expect(mistralSrc).not.toMatch(/content \+= delta\.content\b/)
  })
})