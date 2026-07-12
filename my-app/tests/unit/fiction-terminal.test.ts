import { describe, it, expect } from "vitest"
import { detectPseudoToolCall } from "@/lib/chat/fiction-terminal"

describe("detectPseudoToolCall — fiction structured-terminal bypass detector (advisor phase B9 Q6)", () => {
  // The detector is NON-MUTATING: it only names the bypassed tool. It MUST NOT
  // strip, auto-convert, or execute the payload — only observe, so the route can
  // surface a neutral protocol-status notice and the failure becomes a crisp
  // metric. See VERDICT-phaseB9.md Q6.

  it("returns null for plain review prose with no tool serialization", () => {
    expect(detectPseudoToolCall("ASSESSMENT: The scene moves cleanly. FINDING 1: tense clash.")).toBeNull()
    expect(detectPseudoToolCall("")).toBeNull()
  })

  it("detects a narrated propose_edit:{...} JSON block (the observed bypass)", () => {
    const content =
      "FINDING 1: tense clash.\npropose_edit:{'field': 'body', 'original': 'x', 'replacement': 'y', 'rationale': 'Diagnosis: tense. Basis: Z2.', 'principleId': 'Z2'}"
    expect(detectPseudoToolCall(content)).toEqual({ tool: "propose_edit" })
  })

  it("detects submit_fiction_review:{...} and the tool(args) shape", () => {
    expect(detectPseudoToolCall("submit_fiction_review:{assessment:'ok'}")).toEqual({
      tool: "submit_fiction_review",
    })
    expect(detectPseudoToolCall("submit_fiction_review({assessment:'ok'})")).toEqual({
      tool: "submit_fiction_review",
    })
    expect(detectPseudoToolCall("submit_fiction_review: Fiction review: NO CHANGE recommended.")).toEqual({
      tool: "submit_fiction_review",
    })
  })

  it("detects a fenced JSON tool payload naming propose_edit", () => {
    const content = '```json\n{"name":"propose_edit","arguments":{"field":"body"}}\n```'
    expect(detectPseudoToolCall(content)).toEqual({ tool: "propose_edit" })
  })

  it("does not flag the tool names mentioned in normal prose context", () => {
    // A bare mention ("do not call propose_edit") is NOT a bypass — the detector
    // requires the `:{` / `(` / fenced-JSON shape, so prose discussion of the tool
    // does not trip it.
    expect(detectPseudoToolCall("Do not call propose_edit here; use submit_fiction_review.")).toBeNull()
    expect(detectPseudoToolCall("The propose_edit tool is not offered in fiction mode.")).toBeNull()
  })
})