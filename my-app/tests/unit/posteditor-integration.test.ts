import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const file = readFileSync(
  fileURLToPath(new URL("../../components/PostEditor.tsx", import.meta.url)),
  "utf8"
)

describe("PostEditor — BlogCompanion integration (spec §3/§9)", () => {
  it("renders <BlogCompanion>", () => {
    expect(file).toContain("<BlogCompanion")
  })
  it("passes the spec props (draft/subjectType/subjectKey/threadId/saveInProgress/onApply/onUndo/onThreadReady)", () => {
    expect(file).toContain("saveInProgress=")
    expect(file).toContain("onApply=")
    expect(file).toContain("onUndo=")
    expect(file).toContain("onThreadReady=")
    expect(file).toContain("subjectType=")
    expect(file).toContain("subjectKey=")
  })
  it("uses applyProposalToForm to apply proposals (pure, shared logic)", () => {
    expect(file).toContain("applyProposalToForm")
  })
  it("derives a stable subject key (post.id or draft:uuid)", () => {
    expect(file).toMatch(/post\.id|randomUUID|draft:/)
  })
  it("passes saveInProgress from the save/publish transition (isPending)", () => {
    expect(file).toMatch(/saveInProgress=\{isPending\}|saveInProgress={isPending}/)
  })
  it("wraps the form + companion in the editor-layout grid", () => {
    expect(file).toContain("editor-layout")
    expect(file).toContain("editor-main")
    expect(file).toContain('companion-rail')
  })
})