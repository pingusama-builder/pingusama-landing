import { describe, it, expect } from "vitest"
import { detectPseudoToolCall, evaluateTerminalExpectation } from "@/lib/chat/fiction-terminal"

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

describe("evaluateTerminalExpectation — terminal-expectation notice trigger (advisor phase B10 Q5)", () => {
  // The notice fires only when a fiction turn ended NORMALLY (finish_reason=stop)
  // with no submit_fiction_review call and no prose bypass — the Arm-3 "clean
  // NO CHANGE. prose, no terminal" failure mode. It is NON-MUTATING: the route
  // surfaces a neutral notice; it never strips/converts/executes/retries. The
  // protocol_bypass notice already covers the prose-payload case, so bypassAny
  // suppresses this notice (no double-emit). See VERDICT-phaseB10.md Q5.

  it("fires when finish=stop, no terminal, no bypass, no transport error", () => {
    expect(
      evaluateTerminalExpectation({
        finishReason: "stop",
        terminalCalledAny: false,
        bypassAny: false,
        hadTransportError: false,
      })
    ).toBe(true)
  })

  it("does not fire on a length/cap-exhaustion finish (the flood-cap miss)", () => {
    expect(
      evaluateTerminalExpectation({
        finishReason: "length",
        terminalCalledAny: false,
        bypassAny: false,
        hadTransportError: false,
      })
    ).toBe(false)
  })

  it("does not fire on a tool_calls finish (the terminal path)", () => {
    expect(
      evaluateTerminalExpectation({
        finishReason: "tool_calls",
        terminalCalledAny: true,
        bypassAny: false,
        hadTransportError: false,
      })
    ).toBe(false)
  })

  it("does not fire when the terminal was called (even if finish=stop on a later turn)", () => {
    expect(
      evaluateTerminalExpectation({
        finishReason: "stop",
        terminalCalledAny: true,
        bypassAny: false,
        hadTransportError: false,
      })
    ).toBe(false)
  })

  it("does not fire when a prose bypass was detected (the bypass notice covers it)", () => {
    expect(
      evaluateTerminalExpectation({
        finishReason: "stop",
        terminalCalledAny: false,
        bypassAny: true,
        hadTransportError: false,
      })
    ).toBe(false)
  })

  it("does not fire on a transport/API error", () => {
    expect(
      evaluateTerminalExpectation({
        finishReason: "stop",
        terminalCalledAny: false,
        bypassAny: false,
        hadTransportError: true,
      })
    ).toBe(false)
  })

  it("does not fire when finish_reason is null/unknown", () => {
    expect(
      evaluateTerminalExpectation({
        finishReason: null,
        terminalCalledAny: false,
        bypassAny: false,
        hadTransportError: false,
      })
    ).toBe(false)
  })
})