import { describe, it, expect } from "vitest"
import {
  draftRevision,
  findOccurrences,
  validateProposal,
  applyProposalToForm,
  type Proposal,
  type DraftSnapshot,
} from "@/lib/blog/proposals"

const draft: DraftSnapshot = {
  content_markdown: "# Title\n\nThe opening repeats the title. Some other line.",
  title: "Title",
  excerpt: "",
  meta_description: "",
}

function bodyProposal(over: Partial<Proposal> = {}): Proposal {
  const original = "The opening repeats the title."
  return {
    id: "prop_1",
    field: "body",
    original,
    replacement: "The opening restates the premise.",
    rationale: "Diagnosis: repeats. Edit: restate. Basis: SW1. Tradeoff: none.",
    principleId: "SW1",
    baseRevision: draftRevision(draft),
    range: { start: 9, end: 9 + original.length },
    ...over,
  }
}

describe("draftRevision", () => {
  it("is a 16-char hex string", () => {
    const r = draftRevision(draft)
    expect(r).toMatch(/^[0-9a-f]{16}$/)
  })
  it("changes when any field changes", () => {
    expect(draftRevision({ ...draft, title: "Other" })).not.toBe(draftRevision(draft))
    expect(draftRevision({ ...draft, content_markdown: "x" })).not.toBe(draftRevision(draft))
    expect(draftRevision({ ...draft, excerpt: "e" })).not.toBe(draftRevision(draft))
    expect(draftRevision({ ...draft, meta_description: "m" })).not.toBe(draftRevision(draft))
  })
  it("is stable for identical input", () => {
    expect(draftRevision(draft)).toBe(draftRevision(draft))
  })
})

describe("findOccurrences", () => {
  it("returns all start indices", () => {
    expect(findOccurrences("ababab", "ab")).toEqual([0, 2, 4])
  })
  it("returns [] for an empty needle", () => {
    expect(findOccurrences("abc", "")).toEqual([])
  })
  it("returns [] when absent", () => {
    expect(findOccurrences("abc", "z")).toEqual([])
  })
})

describe("validateProposal", () => {
  it("accepts a well-formed body proposal", () => {
    const p = validateProposal({
      id: "prop_1",
      field: "body",
      original: "x",
      replacement: "y",
      rationale: "r",
      principleId: "O4",
      baseRevision: "abcdef0123456789",
      range: { start: 0, end: 1 },
    })
    expect(p?.field).toBe("body")
    expect(p?.original).toBe("x")
  })
  it("requires originalValue for scalar fields", () => {
    const p = validateProposal({
      id: "p2",
      field: "title",
      replacement: "New Title",
      rationale: "r",
      principleId: "SW1",
      baseRevision: "abcdef0123456789",
    })
    expect(p).toBeNull()
    const ok = validateProposal({
      id: "p2",
      field: "title",
      originalValue: "Old Title",
      replacement: "New Title",
      rationale: "r",
      principleId: "SW1",
      baseRevision: "abcdef0123456789",
    })
    expect(ok?.field).toBe("title")
  })
  it("requires a nonempty original (≤500) for body", () => {
    expect(validateProposal({ id: "p", field: "body", original: "", replacement: "y", rationale: "r", principleId: "O4", baseRevision: "abcdef0123456789" })).toBeNull()
    expect(validateProposal({ id: "p", field: "body", original: "x".repeat(501), replacement: "y", rationale: "r", principleId: "O4", baseRevision: "abcdef0123456789" })).toBeNull()
  })
  it("rejects unknown fields (never slug/status/etc.)", () => {
    expect(validateProposal({ id: "p", field: "slug", replacement: "y", rationale: "r", principleId: "O4", baseRevision: "abcdef0123456789" })).toBeNull()
    expect(validateProposal({ id: "p", field: "status", replacement: "y", rationale: "r", principleId: "O4", baseRevision: "abcdef0123456789" })).toBeNull()
  })
  it("rejects oversized replacement/rationale", () => {
    expect(validateProposal({ id: "p", field: "body", original: "x", replacement: "y".repeat(2001), rationale: "r", principleId: "O4", baseRevision: "abcdef0123456789" })).toBeNull()
    expect(validateProposal({ id: "p", field: "body", original: "x", replacement: "y", rationale: "r".repeat(301), principleId: "O4", baseRevision: "abcdef0123456789" })).toBeNull()
  })
  it("rejects missing/invalid id or baseRevision", () => {
    expect(validateProposal({ field: "body", original: "x", replacement: "y", rationale: "r", principleId: "O4", baseRevision: "abcdef0123456789" })).toBeNull()
    expect(validateProposal({ id: "p", field: "body", original: "x", replacement: "y", rationale: "r", principleId: "O4", baseRevision: "" })).toBeNull()
  })
  it("rejects non-object input", () => {
    expect(validateProposal(null)).toBeNull()
    expect(validateProposal("x")).toBeNull()
    expect(validateProposal(123)).toBeNull()
  })
})

describe("applyProposalToForm", () => {
  it("applies a body edit at the matched range when the draft is unchanged", () => {
    const p = bodyProposal()
    const r = applyProposalToForm(draft, p)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.form.content_markdown).toContain("The opening restates the premise.")
      expect(r.form.content_markdown).not.toContain("The opening repeats the title.")
      expect(r.undo.field).toBe("body")
      expect(r.undo.prevMarkdown).toBe(draft.content_markdown)
    }
  })
  it("applies at the first unique occurrence when only one exists", () => {
    const d: DraftSnapshot = { content_markdown: "alpha beta gamma", title: "", excerpt: "", meta_description: "" }
    const p: Proposal = {
      id: "p",
      field: "body",
      original: "beta",
      replacement: "BETA",
      rationale: "r",
      principleId: "O4",
      baseRevision: draftRevision(d),
      range: { start: 6, end: 10 },
    }
    const r = applyProposalToForm(d, p)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.form.content_markdown).toBe("alpha BETA gamma")
  })
  it("is stale when the anchor no longer occurs exactly once after drift", () => {
    const d: DraftSnapshot = { content_markdown: "beta beta", title: "", excerpt: "", meta_description: "" }
    const p: Proposal = {
      id: "p",
      field: "body",
      original: "beta",
      replacement: "BETA",
      rationale: "r",
      principleId: "O4",
      baseRevision: "0000000000000000", // intentionally mismatched (drift)
      range: { start: 0, end: 3 },
    }
    const r = applyProposalToForm(d, p)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("stale")
  })
  it("re-applies a still-unique original after unrelated drift elsewhere", () => {
    const base: DraftSnapshot = { content_markdown: "keep-me untouched tail", title: "", excerpt: "", meta_description: "" }
    const p: Proposal = {
      id: "p",
      field: "body",
      original: "keep-me",
      replacement: "KEEP-ME",
      rationale: "r",
      principleId: "O4",
      baseRevision: draftRevision(base),
      range: { start: 0, end: 7 },
    }
    const drifted: DraftSnapshot = { ...base, content_markdown: "PREFIX keep-me untouched tail" }
    const r = applyProposalToForm(drifted, p)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.form.content_markdown).toBe("PREFIX KEEP-ME untouched tail")
  })
  it("applies a scalar edit when the current value still equals originalValue", () => {
    const d: DraftSnapshot = { content_markdown: "body", title: "Old Title", excerpt: "", meta_description: "" }
    const p: Proposal = {
      id: "p",
      field: "title",
      originalValue: "Old Title",
      replacement: "New Title",
      rationale: "r",
      principleId: "SW1",
      baseRevision: draftRevision(d),
    }
    const r = applyProposalToForm(d, p)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.form.title).toBe("New Title")
      expect(r.undo.prevScalar).toBe("Old Title")
    }
  })
  it("is stale for a scalar when the current value drifted from originalValue", () => {
    const d: DraftSnapshot = { content_markdown: "body", title: "Edited Title", excerpt: "", meta_description: "" }
    const p: Proposal = {
      id: "p",
      field: "title",
      originalValue: "Old Title",
      replacement: "New Title",
      rationale: "r",
      principleId: "SW1",
      baseRevision: "0000000000000000",
    }
    const r = applyProposalToForm(d, p)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("stale")
  })
})