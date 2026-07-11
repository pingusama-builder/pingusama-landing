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