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
    noChangePreferred?: boolean
    mustNotAssert?: string[]
    mustNotAggregateOverview?: boolean
    mustPreserve?: string[]
    multiFindingExpected?: boolean
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

  it("includes the Summon regression case (intentional hard cut + bilingual gloss + title foreshadow)", () => {
    // Advisor-prescribed behavioral regression: a short voice-led draft that
    // combines the three fiction false-positive classes the companion
    // manufactured on "The Summon". The live-model gate enforces the
    // no-F3-finding / no-F5-edit / no-title-propose_edit assertions; this case
    // captures the expected metadata + UNTRUSTED embedding.
    const c = cases.find((x) => x.id === "fiction-intentional-hard-cut-bilingual-title-foreshadow")
    expect(c).toBeDefined()
    expect(c!.expectations.reviewMode).toBe("fiction")
    expect(c!.expectations.noChangeWilling).toBe(true)
    expect(c!.expectations.expectedRules).toContain("F3")
    expect(c!.expectations.expectedRules).toContain("F5")
    expect(c!.expectations.expectedRules).toContain("F1")
    const p = buildCompanionPrompt({
      writingContext: "ctx",
      memories: [] as MemoryRow[],
      draft: c!.draft,
      reviewMode: "fiction",
    })
    expect(p).toContain("UNTRUSTED TEXT TO ANALYZE")
    expect(p).toContain(c!.draft.content_markdown.slice(0, 20))
  })

  it("the Summon case documents the refinement-03 behavioral bar (A–D must-not-assert + NO CHANGE preferred)", () => {
    // Advisor verdict §"What to build" #6 + §"Structural-overview problem": the
    // regression is stronger than "must-not-appear-as-assertive-defects" — the
    // review must be ABLE to return a specific NO CHANGE assessment and must not
    // aggregate unanchored findings into an authoritative "stumbles on…" verdict.
    // A unit test cannot deterministically pin live model output without a
    // second model pass (rejected); this documents the bar the live gate enforces.
    const c = cases.find((x) => x.id === "fiction-intentional-hard-cut-bilingual-title-foreshadow")
    expect(c).toBeDefined()
    expect(c!.expectations.noChangePreferred).toBe(true)
    expect(c!.expectations.mustNotAggregateOverview).toBe(true)
    const mustNot = c!.expectations.mustNotAssert ?? []
    expect(mustNot).toContain("typography")
    expect(mustNot).toContain("over-explanation")
    expect(mustNot).toContain("clinical-inventory")
    expect(mustNot).toContain("tell")
    // And the prompt that would run this case carries the suppressors: the
    // pre-emission gate, the typography routing line, the positive NO CHANGE
    // example, and the revised backstop pairs.
    const p = buildCompanionPrompt({
      writingContext: "ctx",
      memories: [] as MemoryRow[],
      draft: c!.draft,
      reviewMode: "fiction",
    })
    expect(p).toMatch(/Before emitting each finding, verify all three/)
    expect(p).toMatch(/do not report ordinary spelling, punctuation, typography/)
    expect(p).toContain("NO CHANGE: the precise threat inventory creates grotesque, hyper-literal pressure")
  })

  it("the Summon case requires the edit to preserve the bilingual gloss (edit-layer integrity)", () => {
    // Advisor final verdict: the worst post-patch edit diagnosed the trailing
    // "as if…" clause but silently deleted the "(Are you hurt)" translation —
    // an edit-layer integrity failure, not a finding-layer false positive. The
    // case now records that the edit must preserve the gloss, and the prompt
    // that runs it carries the edit-preservation contract.
    const c = cases.find((x) => x.id === "fiction-intentional-hard-cut-bilingual-title-foreshadow")
    expect(c).toBeDefined()
    expect(c!.expectations.mustPreserve).toContain("bilingual-gloss")
    const p = buildCompanionPrompt({
      writingContext: "ctx",
      memories: [] as MemoryRow[],
      draft: c!.draft,
      reviewMode: "fiction",
    })
    expect(p).toMatch(/Before calling propose_edit, ensure the replacement changes only what the diagnosis identifies/)
    expect(p).toMatch(/Preserve voice markers, code-switching, translation, dialect/)
    // Phase B2 hard gate: the gloss must not be deleted on a taste/economy
    // framing. "this is not a finding" is the explicit exclusion condition.
    expect(p).toMatch(/If none is unclear, this is not a finding/)
    expect(c!.expectations.mustNotAssert).toContain("gloss-deletion")
  })

  it("includes a deliberately messy fiction case that legitimately needs multiple findings (anti one-observation-max)", () => {
    // Advisor final verdict build-order #4: do not universalize the brevity rule
    // from one clean voice-forward opening. "Name the decisive effect once" must
    // not become "one observation maximum." A genuinely messy scene with three
    // distinct reader-level failures (scrambled action chain F3, POV rupture F4,
    // unreadable dialogue intent F5) legitimately needs separate findings — the
    // discriminator is the revision decision, not sentence count.
    const c = cases.find((x) => x.id === "fiction-messy-multi-finding")
    expect(c).toBeDefined()
    expect(c!.expectations.reviewMode).toBe("fiction")
    expect(c!.expectations.multiFindingExpected).toBe(true)
    expect(c!.expectations.noChangePreferred).toBeUndefined()
    expect(c!.expectations.expectedRules).toContain("F3")
    expect(c!.expectations.expectedRules).toContain("F4")
    expect(c!.expectations.expectedRules).toContain("F5")
    const p = buildCompanionPrompt({
      writingContext: "ctx",
      memories: [] as MemoryRow[],
      draft: c!.draft,
      reviewMode: "fiction",
    })
    expect(p).toContain("UNTRUSTED TEXT TO ANALYZE")
    // The aggregation rule permits multiple findings when they identify
    // different reader-level failures / revision decisions.
    expect(p).toMatch(/separate findings only when they identify different reader-level failures/)
  })
})