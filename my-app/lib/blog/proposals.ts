import { createHash } from "node:crypto"

// Pure proposal logic + types shared by the SERVER (companion-tools.ts) and
// the CLIENT (BlogCompanion.tsx). No DB, no React. Keeping both sides on one
// module means the baseRevision hash and the apply/drift semantics are
// identical and unit-testable without a DOM.

export type ProposalField = "body" | "title" | "excerpt" | "meta_description"

export interface ProposalRange {
  start: number
  end: number
}

export interface Proposal {
  id: string
  field: ProposalField
  /** body only: the exact passage to replace (nonempty, ≤500, unique in the draft). */
  original?: string
  replacement: string
  rationale: string
  principleId: string
  /** sha256 first-16-hex of the draft the server saw (drift detection). */
  baseRevision: string
  /** scalar fields only: the field's value at proposal time. */
  originalValue?: string
  /** body only: the matched character range in the received draft. */
  range?: ProposalRange
}

export interface DraftSnapshot {
  content_markdown: string
  title: string
  excerpt: string
  meta_description: string
}

export interface UndoTarget {
  field: ProposalField
  /** body: the full previous content_markdown. */
  prevMarkdown?: string
  /** scalar: the previous field value. */
  prevScalar?: string
}

export type ApplyResult =
  | { ok: true; form: DraftSnapshot; undo: UndoTarget }
  | { ok: false; reason: "stale" | "invalid" }

const FIELDS: ProposalField[] = ["body", "title", "excerpt", "meta_description"]
const MAX_ORIGINAL = 500
const MAX_REPLACEMENT = 2000
const MAX_RATIONALE = 300

/** sha256 of the four draft fields (space-separated), first 16 hex chars. */
export function draftRevision(d: DraftSnapshot): string {
  const h = createHash("sha256")
  h.update(d.content_markdown)
  h.update(" ")
  h.update(d.title)
  h.update(" ")
  h.update(d.excerpt)
  h.update(" ")
  h.update(d.meta_description)
  return h.digest("hex").slice(0, 16)
}

/** All start indices where needle occurs in haystack (no regex, literal). */
export function findOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return []
  const out: number[] = []
  let i = 0
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    out.push(i)
    i += needle.length
  }
  return out
}

/**
 * Runtime schema validation for a network-supplied proposal event. The client
 * calls this on every SSE `proposal` event before rendering; unknown fields
 * or an unknown `field` value → the card is rejected. Never trusts the TS type.
 */
export function validateProposal(raw: unknown): Proposal | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const field = o.field
  if (typeof field !== "string" || !FIELDS.includes(field as ProposalField)) return null
  const f = field as ProposalField
  const replacement = typeof o.replacement === "string" ? o.replacement : ""
  const rationale = typeof o.rationale === "string" ? o.rationale : ""
  const principleId = typeof o.principleId === "string" ? o.principleId : ""
  const id = typeof o.id === "string" && o.id.length > 0 ? o.id : ""
  const baseRevision = typeof o.baseRevision === "string" ? o.baseRevision : ""
  if (!id || !baseRevision) return null
  if (replacement.length === 0 || replacement.length > MAX_REPLACEMENT) return null
  if (rationale.length === 0 || rationale.length > MAX_RATIONALE) return null

  const proposal: Proposal = {
    id,
    field: f,
    replacement,
    rationale,
    principleId,
    baseRevision,
  }

  if (f === "body") {
    if (typeof o.original !== "string" || o.original.length === 0 || o.original.length > MAX_ORIGINAL) {
      return null
    }
    proposal.original = o.original
    const range = o.range
    if (range && typeof range === "object") {
      const r = range as Record<string, unknown>
      if (typeof r.start === "number" && typeof r.end === "number") {
        proposal.range = { start: r.start, end: r.end }
      }
    }
  } else {
    if (typeof o.originalValue !== "string") return null
    proposal.originalValue = o.originalValue
  }
  return proposal
}

/**
 * Pure apply with drift re-validation. Given the LIVE form and a runtime-
 * validated proposal, return the next form + an undo target, or `stale`.
 *
 * body: if draftRevision(form) === baseRevision → the range is still valid →
 *   replace at range. Else recheck `original` occurs exactly once in the
 *   current content_markdown; if yes replace that occurrence; if no → stale.
 * scalar: if the current field value === originalValue → set to replacement;
 *   else stale.
 */
export function applyProposalToForm(form: DraftSnapshot, p: Proposal): ApplyResult {
  if (p.field === "body") {
    const original = p.original ?? ""
    if (!original) return { ok: false, reason: "invalid" }
    const current = draftRevision(form)
    let range = p.range
    if (current !== p.baseRevision) {
      // Drift — revalidate uniqueness in the current body.
      const occ = findOccurrences(form.content_markdown, original)
      if (occ.length === 1) {
        range = { start: occ[0], end: occ[0] + original.length }
      } else {
        return { ok: false, reason: "stale" }
      }
    }
    if (!range || range.start < 0 || range.end > form.content_markdown.length || range.end < range.start) {
      // Last-resort revalidate from original.
      const occ = findOccurrences(form.content_markdown, original)
      if (occ.length !== 1) return { ok: false, reason: "stale" }
      range = { start: occ[0], end: occ[0] + original.length }
    }
    const next =
      form.content_markdown.slice(0, range.start) +
      p.replacement +
      form.content_markdown.slice(range.end)
    return {
      ok: true,
      form: { ...form, content_markdown: next },
      undo: { field: "body", prevMarkdown: form.content_markdown },
    }
  }

  // scalar field
  const key = p.field as Exclude<ProposalField, "body">
  const cur = form[key]
  if (p.originalValue === undefined || cur !== p.originalValue) {
    return { ok: false, reason: "stale" }
  }
  return {
    ok: true,
    form: { ...form, [key]: p.replacement },
    undo: { field: p.field, prevScalar: cur },
  }
}