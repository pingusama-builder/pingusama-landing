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
export type CompanionToolResult = ToolResult & { proposal?: Proposal }

const PROPOSAL_FIELDS: ProposalField[] = ["body", "title", "excerpt", "meta_description"]
const MAX_ORIGINAL = 500
const MAX_REPLACEMENT = 2000
const MAX_RATIONALE = 300

export const COMPANION_ALLOWED = new Set([
  "propose_edit",
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
    case "save_writing_preference":
      return await executeSaveWritingPreference(rawArgs, ctx)
    case "set_model":
      return await executeToolCall(name, rawArgs, ctx)
    default:
      return { content: `Tool unavailable in writing companion: ${name}`, memoryWrite: false }
  }
}