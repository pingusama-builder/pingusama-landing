// Per-turn "needs-web?" classifier — decides whether the companion runs web
// search before the model speaks. Mirrors classifyDifficultyHybrid in
// models.ts: a cheap pure heuristic decides clear cases (zero model calls); a
// single mistral-small call resolves only the borderline band.
//
// Security: this module imports only mistral.ts (the constrained client) and
// types. It performs a read-only decision; it writes nothing and imports no
// site-write function.

import { mistralTurn } from "@/lib/chat/mistral"
import { MODEL_TIERS } from "@/lib/chat/models"
import type { ChatMessageRow } from "@/lib/db/chat"

export type WebDecision = "search" | "no-search" | "site-only"
export interface WebTriggerResult {
  webEnabled: boolean
  decision: WebDecision
  via: "heuristic" | "mistral-small"
}

// ── Pure heuristic ────────────────────────────────────────────────────────
// search-YES: a named external entity + a factual/temporal cue.
// search-NO : greetings, meta/help, site-internal, creative, preference capture.
const NO_TERMS = [
  "my bench",
  "my shelf",
  "my vault",
  "my blog",
  "the bench",
  "the shelf",
  "the vault",
  "add this",
  "how do i use",
  "help me draft",
  "help me write",
  "i like",
  "i prefer",
  "hello",
  "hi ",
  " hey ",
  "thanks",
  "thank you",
]
const YES_TEMPORAL = [
  "latest",
  "recent",
  "newest",
  "current",
  "2024",
  "2025",
  "2026",
  "version",
  "release",
  "released",
  "announced",
  " say ",
  "said",
  "who is",
  "who was",
  "did ",
  "is it true",
]
const YES_DOMAINS = ["versus", " vs ", "compare", "alternative to", "better than"]

export function classifyWebNeed(message: string): {
  score: number
  band: "search" | "no-search" | "borderline"
} {
  const t = ` ${message.toLowerCase().trim()} `
  let score = 0

  // Per-match counting: a question with several temporal cues ("said" + "2025")
  // is a stronger search signal than one with a single cue.
  for (const n of YES_TEMPORAL) if (t.includes(n)) score += 3
  for (const n of YES_DOMAINS) if (t.includes(n)) score += 2
  const noHits = NO_TERMS.filter((n) => t.includes(n)).length
  if (noHits > 0) score -= 4

  // Length cue: a very short greeting is almost certainly no-search.
  if (message.trim().length < 6) score -= 3

  let band: "search" | "no-search" | "borderline"
  if (score >= 5) band = "search"
  else if (score <= 0) band = "no-search"
  else band = "borderline"
  return { score, band }
}

export function parseWebDecision(raw: string): WebDecision | null {
  const t = raw.toLowerCase()
  if (t.includes("site-only")) return "site-only"
  if (t.includes("no-search") || t.includes("nosearch") || t.includes("no")) {
    return "no-search"
  }
  if (t.includes("search") || t.includes("yes")) return "search"
  return null
}

const WEB_TRIGGER_SYSTEM = `You decide whether a chat assistant should run a web search to answer the user's message. Reply with exactly one label, nothing else:
- "search" — the message asks about fresh/external facts the assistant cannot know from the site (news, recent statements, versions, public figures, comparisons between external tools).
- "no-search" — greeting, opinion/advice the assistant gives itself, creative writing, or a personal preference.
- "site-only" — the answer lives in the assistant's own site context (the user's blog, shelf, vault, bench, tools).`

/** Decide whether this turn should run web search. `historyRows` is optional
 * context (excludes the current message) so borderline follow-ups like "did
 * he say that in 2025?" can be judged; heavy pronoun resolution is left to
 * rewriteSearchQueries. Never throws — falls back to the heuristic band. */
export async function decideWebEnabled(
  message: string,
  historyRows: ChatMessageRow[] = []
): Promise<WebTriggerResult> {
  const h = classifyWebNeed(message)
  if (h.band !== "borderline") {
    return {
      webEnabled: h.band === "search",
      decision: h.band === "search" ? "search" : "no-search",
      via: "heuristic",
    }
  }
  // Borderline → one mistral-small call. Build a tiny digest for context.
  const digest = historyRows
    .slice(-6)
    .map((r) => `${r.role}: ${(r.content ?? "").slice(0, 200)}`)
    .join("\n")
  try {
    const acc = await mistralTurn({
      model: MODEL_TIERS.small,
      messages: [
        { role: "system", content: WEB_TRIGGER_SYSTEM },
        {
          role: "user",
          content:
            (digest ? `Recent conversation:\n${digest}\n\n` : "") +
            `Message:\n${message.slice(0, 800)}`,
        },
      ],
      maxTokens: 8,
    })
    const label = parseWebDecision(acc.content)
    const decision: WebDecision =
      label ?? (h.band === "search" ? "search" : "no-search")
    return { webEnabled: decision === "search", decision, via: "mistral-small" }
  } catch {
    // Never block the turn — fall back to heuristic band.
    return {
      webEnabled: h.band === "search",
      decision: h.band === "search" ? "search" : "no-search",
      via: "mistral-small",
    }
  }
}