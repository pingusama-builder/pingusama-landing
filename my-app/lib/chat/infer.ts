// Two-pass memory inference. Reads a thread's transcript, extracts candidate
// durable memories (pass 1, generous), gates them through a strict hygiene
// filter (pass 2, drops transient/derivable/duplicate + consolidates), and
// saves the keeps via the existing saveMemory — so the site:* namespace guard,
// schema validation, and upsert-by-name dedupe all still hold.
//
// SECURITY: this module imports only saveMemory (guarded), read-only
// getMessages/listAllMemories/recallMemories, read-only buildSiteContext (not
// used here but available), and mistralTurn. NO site-write function is ever
// imported. Both Mistral passes are pure text calls with NO tools, so the
// inference LLM has less reach than the chat LLM. A prompt-injected transcript
// can at worst produce a memory whose text content is odd — it still cannot
// name site:* (assertPersonalName rejects) and has zero site-write capability.

import { mistralTurn } from "@/lib/chat/mistral"
import { MODEL_TIERS } from "@/lib/chat/models"
import {
  getMessages,
  listAllMemories,
  recallMemories,
  saveMemory,
  touchInferredAt,
  assertMemoryInput,
  assertPersonalName,
  type ChatMessageRow,
  type MemoryType,
} from "@/lib/db/chat"

const INFERENCE_MODEL = process.env.MISTRAL_INFER_MODEL || MODEL_TIERS.large
const MAX_TRANSCRIPT_CHARS = 100000

export interface InferenceSummary {
  threadId: string
  threadTitle: string
  saved: { name: string; type: MemoryType }[]
  dropped: number
  skipped: number
  inferredAt: string
}

interface RawCandidate {
  type?: string
  name?: string
  description?: string
  content?: string
  links?: unknown
}
interface GatedCandidate extends RawCandidate {
  verdict?: "keep" | "drop"
  reason?: string
}

const PASS1_SYSTEM = `You read a past chat conversation and extract every candidate worth keeping as a DURABLE memory for the site companion. Memory types: user (about the person), feedback (how to respond / corrections), project (what they're building), reference (pointer to a resource), idea (content suggestion). Never use type "site" — site awareness is managed elsewhere. Be generous: extract anything that MIGHT be a durable fact; a later stage filters. Reuse existing memory names to refine rather than duplicate. Return ONLY a JSON array of {type,name,description,content,links?}. If nothing durable, return [].`

const PASS2_SYSTEM = `You are a strict memory hygienist. For each candidate decide: durable+verified vs a transient chat moment; derivable from the site awareness/code (trivia) vs not; a duplicate/near-duplicate of an existing memory vs something to refine. Consolidate near-duplicates (you may return fewer entries than given). For each kept entry refine the name (lowercase kebab) and content. Return ONLY a JSON array of {type,name,description,content,links?,verdict,reason} where verdict is "keep" or "drop". Keep only what is clearly durable and not already known.`

function parseJsonArray(raw: string): unknown[] {
  if (!raw) return []
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end === -1 || end < start) return []
  text = text.slice(start, end + 1)
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function shapeTranscript(rows: ChatMessageRow[]): { transcript: string; enough: boolean } {
  const lines: string[] = []
  let nonTool = 0
  for (const r of rows) {
    if (r.role === "user") {
      nonTool++
      lines.push(`user: ${r.content ?? ""}`)
    } else if (r.role === "assistant") {
      nonTool++
      lines.push(`companion: ${r.content ?? ""}`)
    } else if (r.role === "tool") {
      const name = (r.tool_calls as { name?: string } | null)?.name ?? "tool"
      lines.push(`[tool: ${name}]`)
    }
  }
  let transcript = lines.join("\n")
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS)
  }
  return { transcript, enough: nonTool >= 2 }
}

function titleFrom(rows: ChatMessageRow[]): string {
  const u = rows.find((r) => r.role === "user" && r.content && r.content.trim())
  if (!u) return "conversation"
  const s = (u.content ?? "").trim().replace(/\s+/g, " ")
  return s.length > 60 ? s.slice(0, 60) + "…" : s
}

export async function inferMemoriesFromThread(threadId: string): Promise<InferenceSummary> {
  const inferredAt = new Date().toISOString()
  const rows = await getMessages(threadId)
  const threadTitle = titleFrom(rows)
  const empty: InferenceSummary = {
    threadId,
    threadTitle,
    saved: [],
    dropped: 0,
    skipped: 0,
    inferredAt,
  }

  const { transcript, enough } = shapeTranscript(rows)
  if (!enough) {
    await touchInferredAt(threadId)
    return empty
  }

  const existing = (await listAllMemories({ activeOnly: true })).filter((m) => m.type !== "site")
  const existingNames = existing.map((m) => m.name)

  // Pass 1 — extract (generous).
  const pass1 = await mistralTurn({
    model: INFERENCE_MODEL,
    maxTokens: 2000,
    messages: [
      { role: "system", content: PASS1_SYSTEM },
      {
        role: "user",
        content: `Existing memory names to reuse: ${existingNames.join(", ") || "(none)"}\n\nConversation:\n${transcript}`,
      },
    ],
  })
  const raws = parseJsonArray(pass1.content ?? "").map((x) => x as RawCandidate)
  if (raws.length === 0) {
    await touchInferredAt(threadId)
    return empty
  }

  // Compact site awareness for pass 2 (so it can drop derivable trivia).
  const siteMemories = (await recallMemories({ includeSite: true, limit: 20 })).filter(
    (m) => m.type === "site"
  )
  const siteSummary =
    siteMemories.map((m) => `- ${m.name}: ${m.description}`).join("\n") || "(none)"

  // Pass 2 — hygiene gate (strict).
  const pass2 = await mistralTurn({
    model: INFERENCE_MODEL,
    maxTokens: 2000,
    messages: [
      { role: "system", content: PASS2_SYSTEM },
      {
        role: "user",
        content: `Existing memory names: ${existingNames.join(", ") || "(none)"}\nSite awareness (already known — drop derivable trivia):\n${siteSummary}\n\nCandidates:\n${JSON.stringify(raws, null, 2)}`,
      },
    ],
  })
  const gated = parseJsonArray(pass2.content ?? "").map((x) => x as GatedCandidate)

  const saved: { name: string; type: MemoryType }[] = []
  let dropped = 0
  let skipped = 0

  for (const g of gated) {
    if (g.verdict !== "keep") {
      dropped++
      continue
    }
    const input = {
      type: typeof g.type === "string" ? g.type : "",
      name: typeof g.name === "string" ? g.name : "",
      description: typeof g.description === "string" ? g.description : "",
      content: typeof g.content === "string" ? g.content : "",
      links: Array.isArray(g.links) ? g.links.map(String) : undefined,
    }
    try {
      assertMemoryInput(input)
      assertPersonalName(input.name)
      const row = await saveMemory({
        type: input.type as MemoryType,
        name: input.name,
        description: input.description,
        content: input.content,
        links: input.links,
        sourceThreadId: threadId,
        source: "inference",
      })
      saved.push({ name: row.name, type: row.type })
    } catch {
      skipped++
    }
  }

  await touchInferredAt(threadId)
  return { threadId, threadTitle, saved, dropped, skipped, inferredAt }
}