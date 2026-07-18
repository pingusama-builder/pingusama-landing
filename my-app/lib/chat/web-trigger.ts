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

// Factual-question frames (round 2). A bare "how good is X / what is X / tell
// me about X" about a named external entity with NO temporal/version cue scored
// 0 → no-search → the mistral-small tie-break never ran (the Kimi K3 false-
// negative). A matching frame lifts a suppressed no-search to `borderline` so
// the classifier gets to judge it — NEVER to auto-`search`, because site-
// internal lookups ("what is my shelf?") share the frame and must stay
// contained. No capitalisation signal: users type product names in lowercase,
// CJK/abbreviations don't capitalise, and the site has its own proper nouns
// (book titles, authors) — a cap-token detector would be too noisy. The
// classifier (with a history digest + the site-only label) resolves it.
const FACTUAL_FRAMES = [
  "what is ",
  "what's ",
  "how good is ",
  "tell me about ",
  "give me a summary of ",
  "summarize ",
  "what's new with ",
  "how does ",
  "how do ",
]

// External-information request frames (advisor round 3). Prerequisite /
// sequence / starting / expanding / recommendation requests about a named
// external entity — "which are the pre-requisites for X", "what should i
// watch before X", "where do i start with X", "recommend X for Y" — share the
// same score-0 no-search trap the round-2 factual frames fixed, but the
// round-2 list ("what is / how good is / tell me about") doesn't cover them
// (the Spider-Man thread false-negatived twice on exactly this class). A
// matching frame lifts a suppressed no-search to `borderline` so the existing
// mistral-small classifier gets to judge it — NEVER auto-`search`, because
// the same phrasings cover site-internal requests ("recommend a chair for
// my desk" — site-suppressed via NO_TERMS) and ordinary advice ("recommend a
// book" — the classifier returns no-search).
//
// Intent-family, NOT bare "where do i " / "what should i ": those are too
// broad and would send every planning / site-navigation question to the
// classifier. Two second-person counterparts ("where do you go from ",
// "where do you expand from ") are included because the live smoke phrased
// the expansion request as "where do you expand from there" (addressing the
// companion); the verdict's list used first-person.
//
// Site markers ("this post", "this article", …) are deliberately NOT added
// to NO_TERMS: doing so would break the shipped "tell me about this post" →
// classifier → site-only test (the verdict mandates existing site-only
// tests stay unchanged). "this post" stays handled by the classifier, not
// by heuristic suppression — consistent with the existing path.
const EXTERNAL_INFO_FRAMES = [
  // Prerequisite / sequence
  "what should i watch before ",
  "what should i read before ",
  "what should i play before ",
  "what should i install before ",
  "what do i need to watch before ",
  "what do i need to know before ",
  "what do i need before ",
  "which should i watch before ",
  "which are the ",
  "what are the essential ",
  "what are the minimum ",
  // Starting / expanding / recommendation
  "recommend ",
  "where should i start with ",
  "where do i start with ",
  "where do i go from ",
  "where do you go from ",
  "where do you expand from ",
  "what should i watch next",
  "what should i read next",
  "what should i play next",
  "what else should i watch",
  "what else should i read",
  "what else should i play",
]

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

  // Frame lift: only a suppressed no-search → borderline, and only when the
  // frame has substantive remaining content (≥3 chars after it) and no
  // site-internal NO_TERM fired. Does not touch search (temporal cues still
  // win straight to search) or an already-borderline band. A factual frame
  // (round 2) OR an external-info frame (round 3) triggers the lift — both go
  // through the same classifier, never direct to search.
  if (
    band === "no-search" &&
    noHits === 0 &&
    (hasFrame(t, FACTUAL_FRAMES) || hasFrame(t, EXTERNAL_INFO_FRAMES))
  ) {
    band = "borderline"
  }

  return { score, band }
}

/** A request frame with substantive remaining content (≥3 chars after the
 *  frame). Caller has already checked no NO_TERM fired. */
function hasFrame(t: string, frames: string[]): boolean {
  for (const f of frames) {
    const idx = t.indexOf(f)
    if (idx >= 0 && t.slice(idx + f.length).trim().length >= 3) return true
  }
  return false
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
  const band = h.band
  if (band !== "borderline") {
    return {
      webEnabled: band === "search",
      decision: band === "search" ? "search" : "no-search",
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
    // In the borderline branch the heuristic band is "borderline" → a missing
    // model label defaults to no-search (do not search on uncertainty).
    const decision: WebDecision = label ?? "no-search"
    return { webEnabled: decision === "search", decision, via: "mistral-small" }
  } catch {
    // Never block the turn — fall back to no-search (borderline heuristic).
    return {
      webEnabled: false,
      decision: "no-search",
      via: "mistral-small",
    }
  }
}