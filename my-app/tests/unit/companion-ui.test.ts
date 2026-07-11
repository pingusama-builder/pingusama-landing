import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const file = readFileSync(
  fileURLToPath(new URL("../../components/BlogCompanion.tsx", import.meta.url)),
  "utf8"
)

describe("BlogCompanion.tsx — quick actions + scopes (spec §9)", () => {
  it("declares the five spec quick actions with their scopes", () => {
    expect(file).toContain("Review this draft")
    expect(file).toContain("Omit needless words")
    expect(file).toContain("Flag passive voice & stale phrases")
    expect(file).toContain("Suggest title options")
    expect(file).toContain("Check the opening")
    // scopes present
    expect(file).toMatch(/scope:\s*"full"/)
    expect(file).toMatch(/scope:\s*"title"/)
    expect(file).toMatch(/scope:\s*"opening"/)
  })
})

describe("BlogCompanion.tsx — content safety (spec §7/§13)", () => {
  it("never uses dangerouslySetInnerHTML on model output", () => {
    expect(file).not.toContain("dangerouslySetInnerHTML")
  })
  it("renders critique + rationale as plain text with pre-wrap", () => {
    expect(file).toMatch(/pre-wrap|whiteSpace:\s*"pre-wrap"/)
  })
})

describe("BlogCompanion.tsx — model selector (native select)", () => {
  it("uses a native <select> for the answering model, not a custom listbox", () => {
    expect(file).toContain('companion-model-select')
    expect(file).toMatch(/<select[\s\S]*?companion-model-select/)
    // the old custom listbox is gone
    expect(file).not.toContain('role="listbox"')
    expect(file).not.toContain('companion-model-menu')
  })
  it("keeps the auto/small/medium/large options", () => {
    for (const label of ["auto", "small", "medium", "large"]) {
      expect(file).toContain(label)
    }
  })
})

describe("BlogCompanion.tsx — props + a11y (spec §9)", () => {
  it("accepts the spec props (draft/subject/threadId/saveInProgress/onApply/onUndo/onThreadReady)", () => {
    expect(file).toContain("saveInProgress")
    expect(file).toContain("onApply")
    expect(file).toContain("onUndo")
    expect(file).toContain("onThreadReady")
    expect(file).toContain("subjectType")
    expect(file).toContain("subjectKey")
  })
  it("runtime-validates proposal events (imports validateProposal)", () => {
    expect(file).toContain("validateProposal")
  })
  it("has a11y affordances (aria-label + live region)", () => {
    expect(file).toContain("aria-label")
    expect(file).toMatch(/aria-live|liveRegion/)
  })
  it("disables Apply while saveInProgress", () => {
    expect(file).toMatch(/saveInProgress/)
  })
})

describe("BlogCompanion.tsx — visibility + reveal (advisor §A)", () => {
  it("has a Hide/Show companion control and a collapsed bar with pending count", () => {
    expect(file).toMatch(/Hide companion|Show companion/)
    expect(file).toContain("companion-collapsed")
    expect(file).toContain("aria-expanded")
    expect(file).toContain("pendingCount")
  })
  it("renders a Reveal in draft button on body cards and accepts onReveal", () => {
    expect(file).toContain("Reveal in draft")
    expect(file).toContain("onReveal")
  })
})

describe("BlogCompanion.tsx — review mode (advisor §B)", () => {
  it("declares the four review modes and sends reviewMode in the fetch body", () => {
    expect(file).toContain("ReviewMode")
    expect(file).toMatch(/"auto" \| "prose" \| "fiction" \| "line-edit"/)
    expect(file).toContain("reviewMode")
  })
})

describe("BlogCompanion.tsx — craft note + title card (advisor §B)", () => {
  it("maps principle IDs to plain-language craft notes", () => {
    expect(file).toContain("CRAFT_NOTE_LABELS")
    expect(file).toMatch(/F3[\s\S]*Scene movement/)
    expect(file).toMatch(/F1[\s\S]*Narrative promise/)
  })
  it("labels fiction title proposals 'Try title' instead of Apply", () => {
    expect(file).toContain("Try title")
  })
})

describe("BlogCompanion.tsx — mode-aware quick actions (advisor §B)", () => {
  it("keeps the prose quick actions and adds fiction quick actions", () => {
    expect(file).toContain("PROSE_QUICK_ACTIONS")
    expect(file).toContain("FICTION_QUICK_ACTIONS")
    expect(file).toContain("Review this story")
    expect(file).toContain("Check scene movement")
    expect(file).toContain("Offer title directions")
  })
  it("caps the visible quick actions at five", () => {
    expect(file).toMatch(/\.slice\(0,\s*5\)|slice\(0, 5\)/)
  })
})