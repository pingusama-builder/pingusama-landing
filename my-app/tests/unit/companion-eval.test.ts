import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { buildCompanionPrompt } from "@/lib/chat/companion-prompt"
import type { MemoryRow } from "@/lib/db/chat"

const cases = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../tests/fixtures/companion-eval/cases.json", import.meta.url)),
    "utf8"
  )
) as Array<{
  id: string
  name: string
  draft: { content_markdown: string; title: string; excerpt: string; meta_description: string }
  expectations: {
    voicePreservation: boolean
    noPraise: boolean
    surgical: boolean
    noChangeWilling: boolean
    principleUse: string
    reviewMode?: "auto" | "prose" | "fiction" | "line-edit"
    expectedRules?: string[]
  }
}>

describe("companion eval corpus (spec §13)", () => {
  it("has ≥3 cases with the expected shape", () => {
    expect(Array.isArray(cases)).toBe(true)
    expect(cases.length).toBeGreaterThanOrEqual(3)
    for (const c of cases) {
      expect(c.id).toBeTypeOf("string")
      expect(c.draft.content_markdown).toBeTypeOf("string")
      expect(c.draft.title).toBeTypeOf("string")
      expect(c.expectations).toBeTypeOf("object")
      expect(c.expectations.voicePreservation).toBeTypeOf("boolean")
      expect(c.expectations.noPraise).toBeTypeOf("boolean")
      expect(c.expectations.noChangeWilling).toBeTypeOf("boolean")
      expect(c.expectations.principleUse).toBeTypeOf("string")
    }
  })

  it("includes a case that expects NO CHANGE (originality check)", () => {
    expect(cases.some((c) => c.expectations.noChangeWilling)).toBe(true)
  })

  it("each draft is embedded as UNTRUSTED data in the prompt", () => {
    for (const c of cases) {
      const p = buildCompanionPrompt({
        writingContext: "ctx",
        memories: [] as MemoryRow[],
        draft: c.draft,
      })
      expect(p).toContain("UNTRUSTED TEXT TO ANALYZE")
      expect(p).toContain("<draft>")
      expect(p).toContain("</draft>")
      expect(p).toContain(c.draft.content_markdown.slice(0, 20))
      // Voice-preservation rules are first-class in the prompt.
      expect(p).toContain("V1")
      expect(p).toContain("V2")
      expect(p).toContain("V3")
    }
  })

  it("includes at least 10 fiction cases with a reviewMode + expectedRules", () => {
    const fictionCases = cases.filter((c) => c.expectations.reviewMode === "fiction")
    expect(fictionCases.length).toBeGreaterThanOrEqual(10)
    for (const c of fictionCases) {
      expect(Array.isArray(c.expectations.expectedRules)).toBe(true)
      expect((c.expectations.expectedRules as string[]).length).toBeGreaterThan(0)
    }
  })

  it("fiction cases embed F-lenses in the prompt only in fiction mode", () => {
    for (const c of cases.filter((x) => x.expectations.reviewMode === "fiction")) {
      const p = buildCompanionPrompt({
        writingContext: "ctx",
        memories: [] as MemoryRow[],
        draft: c.draft,
        reviewMode: "fiction",
      })
      expect(p).toContain("F1 — Narrative promise")
      expect(p).toContain("F3 — Scene movement")
      // prose mode must NOT show fiction lenses for the same draft
      const prose = buildCompanionPrompt({
        writingContext: "ctx",
        memories: [] as MemoryRow[],
        draft: c.draft,
        reviewMode: "prose",
      })
      expect(prose).not.toContain("F1 — Narrative promise")
    }
  })

  it("includes a fiction no-change case (preserve strange/quiet fiction)", () => {
    expect(
      cases.some((c) => c.expectations.reviewMode === "fiction" && c.expectations.noChangeWilling)
    ).toBe(true)
  })
})