// Pure detector for the fiction structured-terminal bypass (advisor phase B9 Q6).
//
// The model sometimes narrates a tool call as prose — e.g.
//   propose_edit:{'field': 'body', 'original': '...', 'replacement': '...'}
//   submit_fiction_review:{assessment: '...', findings: [...]}
// instead of actually calling the tool. This is a protocol-adherence failure
// (the structured terminal is the only edit path in fiction mode): the edit
// never lands, no card renders, and the author sees a misleading empty state.
//
// This detector is NON-MUTATING. It only NAMES the bypassed tool. It MUST NOT
// strip, auto-convert, or execute the payload — the route surfaces a neutral
// protocol-status notice ("The review contained an unsubmitted edit payload; no
// edit proposal was created.") and logs the bypass as a crisp metric. Laundering
// the prose into an action would hide the substrate failure, not fix it.
//
// Signature matched: a fiction-tool name (propose_edit | submit_fiction_review)
// immediately followed by `:`, `{`, or `(` (the prose-JSON shapes seen in the
// wild — `tool:{...}`, `tool({...})`, `tool: prose`), OR a fenced ``` block whose
// body quotes a fiction-tool `name`. A bare mention of the tool name in prose
// ("do not call propose_edit") is NOT a bypass — the `:{` / `(` / fenced shape is
// required, so discussing the tool does not trip the detector.
//
// See ai-advisor/refinement-03-fiction-examples-extension/VERDICT-phaseB9.md Q6.

const FICTION_TOOL_NAMES = ["propose_edit", "submit_fiction_review"] as const

// A tool name followed by `:`, `{`, or `(` (allowing optional whitespace between
// the name and the delimiter). Captures the prose-JSON shape `tool:{...}`,
// `tool({...})`, and the narrated-notice shape `tool: ...`.
const INLINE_SHAPE = new RegExp(`\\b(?:${FICTION_TOOL_NAMES.join("|")})\\s*[:({]`)

// A fenced block (```...```) whose body quotes a fiction-tool name as a JSON
// `name` field — the "equivalent fenced JSON tool payload" from the verdict.
const FENCED_SHAPE = /```[^`]*?"name"\s*:\s*"(?:propose_edit|submit_fiction_review)"/

export function detectPseudoToolCall(content: string): { tool: string } | null {
  if (!content) return null
  const inline = content.match(INLINE_SHAPE)
  if (inline) {
    const name = inline[0].match(/propose_edit|submit_fiction_review/)![0]
    return { tool: name }
  }
  if (FENCED_SHAPE.test(content)) {
    const nameMatch = content.match(/"name"\s*:\s*"(propose_edit|submit_fiction_review)"/)
    if (nameMatch) return { tool: nameMatch[1] }
  }
  return null
}

// ── Terminal-expectation notice trigger (advisor phase B10 Q5) ───────────
// In fiction mode the structured terminal (submit_fiction_review) is the only
// edit path. A demonstrated failure mode (the B9 A/B "Arm 3" skip): the model
// ends normally (finish_reason=stop) with clean prose — e.g. "NO CHANGE." —
// but never calls submit_fiction_review, so no assessment/findings/edit cards
// are produced and the author sees a misleading empty state. This helper is
// the NON-MUTATING trigger for a neutral admin-only notice. It MUST NOT cause
// the route to strip, synthesize, execute, or retry anything.
//
// Fire only when ALL hold: finish_reason === "stop" (a normal end, not a
// cap-exhaustion "length" or a transport error), no submit_fiction_review was
// called across the whole run (terminalCalledAny), and no prose bypass was
// detected (bypassAny — the protocol_bypass notice already covers that case,
// so suppressing here avoids a double-emit). A genuine NO CHANGE review must
// still submit the terminal with an empty finding set; this notice flags the
// one that did not.
//
// See ai-advisor/refinement-03-fiction-examples-extension/VERDICT-phaseB10.md Q5.

export interface TerminalExpectationInput {
  /** Last-turn finish_reason. Only "stop" fires the notice. */
  finishReason: string | null
  /** True if any turn called submit_fiction_review. */
  terminalCalledAny: boolean
  /** True if any turn's prose tripped detectPseudoToolCall (with no terminal). */
  bypassAny: boolean
  /** True if the stream threw / aborted (a transport or API error). */
  hadTransportError: boolean
}

export function evaluateTerminalExpectation(input: TerminalExpectationInput): boolean {
  return (
    input.finishReason === "stop" &&
    !input.terminalCalledAny &&
    !input.bypassAny &&
    !input.hadTransportError
  )
}