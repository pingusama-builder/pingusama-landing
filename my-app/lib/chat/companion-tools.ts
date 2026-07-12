import { createHash } from "node:crypto"
import { executeToolCall, type ToolContext, type ToolResult } from "@/lib/chat/tools"
import {
  saveMemory,
  assertMemoryInput,
  assertWritingPrefName,
  type MemoryType,
} from "@/lib/db/chat"
import type { MistralTool } from "@/lib/chat/mistral"
import {
  draftRevision,
  findOccurrences,
  type Proposal,
  type ProposalField,
  type DraftSnapshot,
} from "@/lib/blog/proposals"

// ── The companion's NARROW tool surface ─────────────────────────────────
// Three tools only. The shared executeToolCall still knows refresh_awareness/
// read_code/save_memory/update_memory/delete_memory — so filtering the tool
// DEFINITIONS sent to Mistral is NOT a security boundary. The real boundary is
// the deny-by-default COMPANION_ALLOWED set: executeCompanionToolCall refuses
// anything not in it, so prompt injection in the draft cannot reach those tools.

export type CompanionDraft = DraftSnapshot
export type FictionReviewPayload = {
  assessment: string
  noChange: boolean
  findings: { diagnosis: string; principleId: string; hasEdit: boolean }[]
}
export type CompanionToolResult = ToolResult & {
  proposal?: Proposal
  proposals?: Proposal[]
  fictionReview?: FictionReviewPayload
}

const PROPOSAL_FIELDS: ProposalField[] = ["body", "title", "excerpt", "meta_description"]
const MAX_ORIGINAL = 500
const MAX_REPLACEMENT = 2000
const MAX_RATIONALE = 300
const MAX_ASSESSMENT = 300

export const COMPANION_ALLOWED = new Set([
  "propose_edit",
  "submit_fiction_review",
  "save_writing_preference",
  "set_model",
])

export const COMPANION_TOOLS: MistralTool[] = [
  {
    type: "function",
    function: {
      name: "propose_edit",
      description:
        "Propose ONE surgical edit to the author's draft. Only call this when the user has explicitly requested an edit, or when a violation is unambiguous (a grammar error, a factual error, or a clear O/SW/Z-rule breach with evidence). Do NOT propose rewrites of passages that may be stylistic choices. When uncertain, ask or recommend no change. field must be body, title, excerpt, or meta_description (never slug/status/published_at/cover_image_url/tags/category). For body, quote the exact passage in `original` — it must occur exactly once in the draft, so include enough surrounding context to be unique; there is no append/insert (no empty original). replacement is the new text; rationale follows the Diagnosis/Edit/Basis/Tradeoff shape (≤300 chars); principleId is a compact rule ID (O1–O6, SW1–SW4, Z1–Z3, V1–V3).",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: ["body", "title", "excerpt", "meta_description"],
            description: "Which field to edit. body = the markdown content.",
          },
          original: {
            type: "string",
            description: "body only: the exact passage to replace (1–500 chars). Must occur exactly once in the draft body. Omit for scalar fields.",
          },
          replacement: {
            type: "string",
            description: "The new text (1–2000 chars).",
          },
          rationale: {
            type: "string",
            description: "Diagnosis: <one sentence>. Edit: <the replacement>. Basis: <principle ID>. Tradeoff: <uncertainty>. ≤300 chars.",
          },
          principleId: {
            type: "string",
            description: "A compact rule ID, e.g. O4, SW1, Z1, V1.",
          },
        },
        required: ["field", "replacement", "rationale", "principleId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_writing_preference",
      description:
        "Save a DURABLE writing preference the author has EXPLICITLY stated in this conversation (e.g. 'I always want short paragraphs', 'don't touch my em-dashes'). Call this ONLY for an explicit user statement — NEVER infer a preference from a single draft (that works against originality). The name MUST start with 'writing-' (e.g. 'writing-prefers-fragment-sentences'). This writes to the memory bank as type=feedback; it cannot edit the post.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "A kebab slug starting with 'writing-', e.g. 'writing-keep-em-dashes'.",
          },
          description: { type: "string", description: "One-line summary." },
          content: { type: "string", description: "The preference, stated as a durable rule." },
        },
        required: ["name", "description", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_model",
      description:
        "Switch which Mistral model answers this companion thread. tier: small (quick), medium (balanced), large (strongest for a full review), or auto. scope: 'persistent' (from now on, this thread) or 'turn' (just the next response). This only changes the answering model — it cannot edit the post.",
      parameters: {
        type: "object",
        properties: {
          tier: { type: "string", enum: ["small", "medium", "large", "auto"] },
          scope: { type: "string", enum: ["persistent", "turn"] },
        },
        required: ["tier"],
      },
    },
  },
]

// ── Fiction structured terminal ───────────────────────────────────────────
// The prose-edit loophole (advisor phase B8): on a non-reasoning substrate the
// model narrated "Proposed edit: original: / Replacement:" in prose instead of
// calling a tool, bypassing the tool layer. submit_fiction_review is the
// input-side mechanical guard: the model submits the WHOLE review as ONE
// structured call (assessment + noChange + findings[]; each finding optionally
// carries a surgical body edit). There is no prose assessment slot to narrate
// into — assessment lives inside the call. Fiction mode offers ONLY this tool
// (no propose_edit), so there is no separate edit path to loophole through.
// Pure (no DB, no import) — reuses the same validation rules as executeProposal.
export const FICTION_REVIEW_TOOL: MistralTool = {
  type: "function",
  function: {
    name: "submit_fiction_review",
    description:
      "Submit the full fiction review as ONE structured call. Carries the assessment, a noChange flag, and findings[]; each finding optionally carries a surgical body edit (original+replacement+rationale). This is the ONLY way to propose edits in fiction mode — do NOT narrate edits in prose. field is always body; original must occur exactly once in the draft. noChange:true ⟹ findings must be empty. principleId is a compact rule ID (O1–O6, SW1–SW4, Z1–Z3, V1–V3). A finding without original/replacement is a diagnosis-only observation.",
    parameters: {
      type: "object",
      properties: {
        assessment: { type: "string", description: "≤300 chars. The one-line review verdict." },
        noChange: { type: "boolean", description: "true if you recommend NO CHANGE." },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              diagnosis: { type: "string", description: "What's wrong, one sentence." },
              principleId: { type: "string", description: "Compact rule ID, e.g. Z2." },
              original: { type: "string", description: "body edits: exact anchor, must occur once, ≤500 chars. Omit for diagnosis-only." },
              replacement: { type: "string", description: "1–2000 chars. Present iff proposing an edit." },
              rationale: { type: "string", description: "Diagnosis/Edit/Basis/Tradeoff, ≤300 chars. Present iff proposing an edit." },
            },
            required: ["diagnosis", "principleId"],
          },
        },
      },
      required: ["assessment", "noChange", "findings"],
    },
  },
}

/** Fiction mode gets the structured terminal only (no propose_edit — the review
 * is ONE call, so there is no separate edit path to loophole through). Other
 * modes keep the existing blog tool set. */
export function companionToolsFor(reviewMode: string | undefined): MistralTool[] {
  if (reviewMode === "fiction") {
    return [
      FICTION_REVIEW_TOOL,
      ...COMPANION_TOOLS.filter((t) => t.function.name !== "propose_edit"),
    ]
  }
  return COMPANION_TOOLS
}

function stableId(baseRevision: string, field: string, original: string, replacement: string): string {
  return (
    "prop_" +
    createHash("sha256")
      .update(`${baseRevision}|${field}|${original}|${replacement}`)
      .digest("hex")
      .slice(0, 12)
  )
}

function tryParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>
  } catch {
    throw new Error("Tool arguments were not valid JSON.")
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : ""
}

/**
 * propose_edit — pure. No DB, no import. The server has the ground-truth draft
 * (sent by the client each turn), so it validates + resolves the edit and
 * returns a fully-validated proposal to emit as an SSE event. Returns concise
 * `content` (for the tool log + the persisted tool-result row) plus the
 * structured `proposal` (the audit trail is the assistant row's tool_calls).
 */
export function executeProposal(rawArgs: string, draft: CompanionDraft): CompanionToolResult {
  let args: Record<string, unknown>
  try {
    args = tryParseArgs(rawArgs)
  } catch (e) {
    return { content: `Tool error: ${(e as Error).message}`, memoryWrite: false }
  }

  const field = args.field
  if (typeof field !== "string" || !PROPOSAL_FIELDS.includes(field as ProposalField)) {
    return {
      content: `Tool error: invalid field "${String(field)}". Use body, title, excerpt, or meta_description.`,
      memoryWrite: false,
    }
  }
  const f = field as ProposalField
  const replacement = asString(args.replacement)
  const rationale = asString(args.rationale)
  const principleId = asString(args.principleId)

  if (replacement.length === 0 || replacement.length > MAX_REPLACEMENT) {
    return {
      content: `Tool error: replacement must be 1–${MAX_REPLACEMENT} chars (got ${replacement.length}).`,
      memoryWrite: false,
    }
  }
  if (rationale.length === 0 || rationale.length > MAX_RATIONALE) {
    return { content: `Tool error: rationale must be 1–${MAX_RATIONALE} chars.`, memoryWrite: false }
  }
  if (!principleId) {
    return { content: "Tool error: principleId is required (e.g. O4, SW1, Z1, V1).", memoryWrite: false }
  }

  const baseRevision = draftRevision(draft)

  if (f === "body") {
    const original = asString(args.original)
    if (original.length === 0) {
      return {
        content:
          "Tool error: body edits require a nonempty `original` anchor (no append/insert). Quote the exact passage to replace.",
        memoryWrite: false,
      }
    }
    if (original.length > MAX_ORIGINAL) {
      return {
        content: `Tool error: \`original\` anchor must be ≤${MAX_ORIGINAL} chars (got ${original.length}). Quote a shorter unique passage.`,
        memoryWrite: false,
      }
    }
    const occ = findOccurrences(draft.content_markdown, original)
    if (occ.length !== 1) {
      return {
        content: `Tool error: the \`original\` anchor must occur exactly once in the draft body (found ${occ.length}). Retry with more surrounding context so the passage is unique.`,
        memoryWrite: false,
      }
    }
    const range = { start: occ[0], end: occ[0] + original.length }
    const proposal: Proposal = {
      id: stableId(baseRevision, f, original, replacement),
      field: f,
      original,
      replacement,
      rationale,
      principleId,
      baseRevision,
      range,
    }
    return { content: `Proposed ${f} edit (${principleId}).`, proposal, memoryWrite: false }
  }

  // scalar field — record the current value as originalValue (drift detection).
  const key = f as Exclude<ProposalField, "body">
  const originalValue = draft[key]
  const proposal: Proposal = {
    id: stableId(baseRevision, f, originalValue, replacement),
    field: f,
    replacement,
    rationale,
    principleId,
    baseRevision,
    originalValue,
  }
  return { content: `Proposed ${f} edit (${principleId}).`, proposal, memoryWrite: false }
}

/**
 * submit_fiction_review — the structured terminal for fiction mode. Pure (no
 * DB, no import): parses the one-call review, validates each finding's
 * optional surgical edit with the SAME rules as executeProposal (anchor-
 * occurs-once, rationale 1–300, replacement 1–2000, original ≤500, field is
 * always body), and returns an array of validated proposals (one per valid
 * finding-with-edit) + a fictionReview payload for the UI. Invalid findings
 * have their edit skipped (hasEdit:false) but still appear in the review
 * payload as observations — no all-or-nothing. noChange:true ⟹ empty
 * findings (validator rejects otherwise).
 */
export function executeFictionReview(
  rawArgs: string,
  draft: CompanionDraft
): CompanionToolResult {
  let args: Record<string, unknown>
  try {
    args = tryParseArgs(rawArgs)
  } catch (e) {
    return { content: `Tool error: ${(e as Error).message}`, memoryWrite: false }
  }
  const assessment = asString(args.assessment)
  const noChange = args.noChange === true
  const findings = Array.isArray(args.findings) ? args.findings : []

  if (!assessment || assessment.length > MAX_ASSESSMENT) {
    return { content: `Tool error: assessment must be 1–${MAX_ASSESSMENT} chars.`, memoryWrite: false }
  }
  if (noChange && findings.length > 0) {
    return {
      content:
        "Tool error: noChange is true but findings is non-empty — do not propose edits alongside a NO CHANGE recommendation.",
      memoryWrite: false,
    }
  }
  if (!noChange && findings.length === 0) {
    return {
      content:
        "Tool error: noChange is false but findings is empty — either set noChange:true (recommend NO CHANGE) or provide at least one finding.",
      memoryWrite: false,
    }
  }

  const baseRevision = draftRevision(draft)
  const proposals: Proposal[] = []
  const reviewFindings: FictionReviewPayload["findings"] = []
  let editCount = 0

  for (const f of findings) {
    if (!f || typeof f !== "object") continue
    const fin = f as {
      diagnosis?: unknown
      principleId?: unknown
      original?: unknown
      replacement?: unknown
      rationale?: unknown
    }
    const diagnosis = asString(fin.diagnosis)
    const principleId = asString(fin.principleId)
    if (!diagnosis || !principleId) continue // skip a malformed finding
    const original = asString(fin.original)
    const replacement = asString(fin.replacement)
    const rationale = asString(fin.rationale)
    const wantsEdit = original.length > 0 || replacement.length > 0
    if (!wantsEdit) {
      reviewFindings.push({ diagnosis, principleId, hasEdit: false })
      continue
    }
    // validate as a body edit (same rules as executeProposal)
    if (!replacement || replacement.length > MAX_REPLACEMENT) {
      reviewFindings.push({ diagnosis, principleId, hasEdit: false })
      continue
    }
    if (!rationale || rationale.length > MAX_RATIONALE) {
      reviewFindings.push({ diagnosis, principleId, hasEdit: false })
      continue
    }
    if (original.length === 0 || original.length > MAX_ORIGINAL) {
      reviewFindings.push({ diagnosis, principleId, hasEdit: false })
      continue
    }
    const occ = findOccurrences(draft.content_markdown, original)
    if (occ.length !== 1) {
      reviewFindings.push({ diagnosis, principleId, hasEdit: false })
      continue
    }
    proposals.push({
      id: stableId(baseRevision, "body", original, replacement),
      field: "body",
      original,
      replacement,
      rationale,
      principleId,
      baseRevision,
      range: { start: occ[0], end: occ[0] + original.length },
    })
    editCount += 1
    reviewFindings.push({ diagnosis, principleId, hasEdit: true })
  }

  const content = noChange
    ? "Fiction review: NO CHANGE recommended."
    : `Fiction review: ${reviewFindings.length} finding(s), ${editCount} edit(s) proposed.`
  return {
    content,
    memoryWrite: false,
    proposals,
    fictionReview: { assessment, noChange, findings: reviewFindings },
  }
}

/**
 * save_writing_preference — handled INLINE (it is not a name executeToolCall
 * knows). Enforces the shared cap, the writing- prefix (via
 * assertWritingPrefName, which also rejects site:*), and the feedback type,
 * then calls the guarded saveMemory. Counted identically to save_memory.
 */
async function executeSaveWritingPreference(
  rawArgs: string,
  ctx: ToolContext
): Promise<CompanionToolResult> {
  if (ctx.memoryWrites >= ctx.maxMemoryWrites) {
    return {
      content: `Memory write skipped: per-turn cap (${ctx.maxMemoryWrites}) reached. Continue the review; you can save more next turn.`,
      memoryWrite: false,
    }
  }
  let args: Record<string, unknown>
  try {
    args = tryParseArgs(rawArgs)
  } catch (e) {
    return { content: `Tool error: ${(e as Error).message}`, memoryWrite: false }
  }
  const name = asString(args.name)
  const description = asString(args.description)
  const content = asString(args.content)
  try {
    assertWritingPrefName(name)
    assertMemoryInput({ type: "feedback", name, description, content })
  } catch (e) {
    return { content: `Tool error: ${(e as Error).message}`, memoryWrite: false }
  }
  try {
    const row = await saveMemory({
      type: "feedback" as MemoryType,
      name,
      description,
      content,
      sourceThreadId: ctx.sourceThreadId,
      source: "chat",
    })
    ctx.memoryWrites += 1
    return { content: `Saved writing preference "${row.name}".`, memoryWrite: true }
  } catch (e) {
    return { content: `Tool error: ${(e as Error).message}`, memoryWrite: false }
  }
}

/**
 * The deny-by-default dispatch gate. The allowlist is the security boundary.
 * set_model delegates to the reviewed executeToolCall (it validates tier/scope
 * and only touches the thread's model columns).
 */
export async function executeCompanionToolCall(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
  draft: CompanionDraft
): Promise<CompanionToolResult> {
  if (!COMPANION_ALLOWED.has(name)) {
    return { content: `Tool unavailable in writing companion: ${name}`, memoryWrite: false }
  }
  switch (name) {
    case "propose_edit":
      return executeProposal(rawArgs, draft)
    case "submit_fiction_review":
      return executeFictionReview(rawArgs, draft)
    case "save_writing_preference":
      return await executeSaveWritingPreference(rawArgs, ctx)
    case "set_model":
      return await executeToolCall(name, rawArgs, ctx)
    default:
      return { content: `Tool unavailable in writing companion: ${name}`, memoryWrite: false }
  }
}