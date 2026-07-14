// Web-search query rewrite + subject extraction.
//
// The /api/chat route used to pass the user's RAW message to Tavily as the
// search query. That breaks for follow-up questions whose subject lives only
// in conversation context — "2025-2026他有講AI內容?" ("has he talked about AI
// in 2025-2026?"), where "他" refers to a person named earlier. Tavily has no
// conversation context, so it searched a subject-less Chinese string and
// returned general AI articles unrelated to the person; the answering model
// then glued those articles onto the subject (attributing a different
// speaker's conference talk to "Dan Koe").
//
// This module runs a cheap small-model call BEFORE the search to turn the
// message + recent history into a self-contained query that names the subject
// explicitly ("Dan Koe AI 2025 2026"), and to extract the subject proper name
// so the route can run the subject-presence guard in tavily-search.ts.
//
// Pure parsing helper + env-free; the Mistral call reuses the shared client.
// Never blocks a turn: on any failure it falls back to { query: message,
// subject: null } and the route proceeds as it did before this module existed.

import { mistralTurn } from "@/lib/chat/mistral"
import { MODEL_TIERS } from "@/lib/chat/models"
import type { ChatMessageRow } from "@/lib/db/chat"

export interface SearchQueryRewrite {
  query: string
  subject: string | null
}

const MAX_HISTORY_TURNS = 6
const MAX_ROW_CHARS = 300
const REWRITE_MAX_TOKENS = 120

/** Build a compact oldest→newest conversation digest from prior rows (user +
 * assistant text only). Tool rows and tool_calls are dropped: the rewrite only
 * needs the conversational subject, and passing lone tool messages would also
 * violate the Mistral API (a tool message must follow an assistant tool_call). */
function conversationDigest(priorRows: ChatMessageRow[]): string {
  const rows = priorRows.slice(-MAX_HISTORY_TURNS * 2)
  const lines: string[] = []
  for (const r of rows) {
    if (r.role === "user") {
      lines.push(`user: ${(r.content ?? "").slice(0, MAX_ROW_CHARS)}`)
    } else if (r.role === "assistant" && r.content) {
      lines.push(`assistant: ${r.content.slice(0, MAX_ROW_CHARS)}`)
    }
  }
  return lines.join("\n")
}

/** Extract the first {...} JSON object from a model reply that may wrap it in
 * prose or ```json fences. Returns null if no valid object is found. Pure.
 *
 * This is the MECHANICAL GUARD for the non-reasoning substrate (mistral-small-
 * latest: 0 thinking chunks, echoes as itself — see llm-substrate-tuning/
 * references/mistral.md). On a non-reasoning model the prompt clause "output
 * JSON only, no fences" is probabilistic — the model will sometimes wrap the
 * object in fences or surround it with prose. We do NOT rely on that clause
 * holding; this parser recovers the JSON regardless. If it ever fails to find
 * valid JSON, do NOT "fix" it by re-wording the prompt (the substrate trap) —
 * the normalizeRewrite + try/catch fallback in rewriteSearchQuery already
 * degrades gracefully to the raw message. */
export function parseRewriteJson(raw: string): { query?: unknown; subject?: unknown } | null {
  const start = raw.indexOf("{")
  if (start < 0) return null
  // Scan for the matching closing brace (naive — fine for a flat 2-field object).
  let depth = 0
  let end = -1
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth += 1
    else if (raw[i] === "}") {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as { query?: unknown; subject?: unknown }
  } catch {
    return null
  }
}

/** Normalize a rewrite result: query is a non-empty string, subject is a
 * trimmed proper name or null. Pure. */
export function normalizeRewrite(parsed: {
  query?: unknown
  subject?: unknown
} | null, fallback: string): SearchQueryRewrite {
  if (!parsed) return { query: fallback, subject: null }
  const query =
    typeof parsed.query === "string" && parsed.query.trim()
      ? parsed.query.trim().slice(0, 200)
      : fallback
  const subjectRaw = typeof parsed.subject === "string" ? parsed.subject.trim() : ""
  const subject = subjectRaw && subjectRaw.toLowerCase() !== "null" ? subjectRaw.slice(0, 80) : null
  return { query, subject }
}

const REWRITE_SYSTEM = `You rewrite a user's chat message into a self-contained web search query, and name the entity the question is about.

The message may use pronouns or shorthand (他/她/它/this/that/they) that refer to a person, brand, or topic discussed earlier in the conversation. Resolve them to the explicit name.

Reply with ONE JSON object and nothing else — no prose, no code fences:
{"query": "<self-contained search query>", "subject": "<proper name of the entity, or null>"}

Rules:
- query MUST be self-contained: no pronouns; include the subject's name explicitly.
- If the subject is an English-language figure, brand, or company, write the query in English. Otherwise keep the user's language.
- query is a concise web-search string (≤ 12 words), not a full sentence.
- subject is a short proper name (e.g. "Dan Koe", "OpenAI", "Supabase") or null if there is no single named entity.
- Output JSON only.`

/** Rewrite a user message into a self-contained search query + extract the
 * subject entity, using recent conversation history to resolve pronouns.
 * Falls back to { query: message, subject: null } on any error so the turn
 * never blocks. `priorRows` should exclude the current user message. */
export async function rewriteSearchQuery(
  message: string,
  priorRows: ChatMessageRow[]
): Promise<SearchQueryRewrite> {
  const digest = conversationDigest(priorRows)
  const userPrompt = digest
    ? `Recent conversation (oldest → newest):\n${digest}\n\nCurrent message:\n${message}\n\nReturn the JSON.`
    : `Current message:\n${message}\n\nReturn the JSON.`

  try {
    const acc = await mistralTurn({
      model: MODEL_TIERS.small,
      messages: [
        { role: "system", content: REWRITE_SYSTEM },
        { role: "user", content: userPrompt.slice(0, 4000) },
      ],
      maxTokens: REWRITE_MAX_TOKENS,
    })
    return normalizeRewrite(parseRewriteJson(acc.content), message)
  } catch {
    // Never block the turn — search the raw message as before.
    return { query: message, subject: null }
  }
}