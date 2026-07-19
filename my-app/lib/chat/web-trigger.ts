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

// Exported so the live classifier-variance harness (advisor round-5 B.1) can
// replicate the deployed borderline call verbatim and capture the RAW model
// output (the verdict asks for full raw classifications, not only aggregate
// rates). No behavior change to the deployed path.
export const WEB_TRIGGER_SYSTEM = `You decide whether a chat assistant should run a web search to answer the user's message. Reply with exactly one label, nothing else:
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

// ── External-verification suggestion (advisor round-7 pivot) ───────────────
// The pivot replaces the autonomous browse/no-browse decision with a
// SUGGESTION: detect that a turn *may* benefit from external verification,
// surface an inline [Search public sources] / [Stay on this site] choice, and
// let the user pick. The detector only PROPOSES — it never searches. Final
// browse/no-browse authority moves to the user (doctrine: the most robust
// guard — deterministic, auditable, human, immune to the probabilistic
// classifier the prior arc fought).
//
// v1 is lexical/heuristic + provenance ONLY — NO model call. The verdict's
// "low confidence the fact is in site context" signal is model-side/
// probabilistic (the output-side layer the doctrine distrusts) and is
// deferred to a later round if the heuristic signals under-suggest in prod.
//
// Conservative by design (reconcile scrutinize #1): a too-broad detector is a
// naggy companion. Suggestion rate is a first-class product metric. Start
// narrow, widen from observed miss-data. The prereq/sequence family is
// GATED by the external-object cue v0 (title-like colon OR a closed 54-term
// software-domain list) — the cue distinguishes "prerequisites for
// Kubernetes" (external → suggest) from "prerequisites for a good desk
// chair" (advice → don't suggest). The bare-word media-title gap
// ("prerequisites for Inception?" — no colon, not software) is a known v1
// positive-boundary gap; under the suggestion model a missed external object
// is a missing suggestion, NOT a wrong answer (the user can type /web), so
// the gap is low-stakes and observed-from-prod before widening.
export type SuggestionReason =
  | "external-prerequisites" // prereq/sequence pattern + external-object cue (B.2 work)
  | "current-public-facts" // currentness/reception word (latest/reviews/release/...) on a non-site turn
  | "attribution-or-quote" // "did X say", "who said", "is this quote real"
  | "recent-subject-follow-up" // B.3: short factual follow-up to a recently web-verified external subject

export interface VerificationSuggestion {
  suggested: boolean
  reason?: SuggestionReason
  /** Best-effort lexical subject (the external entity/object), or null if it
   *  can't be extracted (e.g. an anaphoric "it" resolved only via provenance
   *  is filled in by the recent-subject-follow-up branch). Never a model
   *  guess. */
  subject?: string | null
}

// Prereq / sequence / starting request patterns. The capture group is the
// substantive object (≥3 chars — the substantive-object guard inherited from
// B.2). These are the B.2 regexes + the "start with" onboarding forms. ALL
// are cue-gated (passesExternalObjectCue) — the cue is what keeps advice
// ("prerequisites for a good desk chair") from suggesting.
// Case-insensitive so natural casing ("should I start", "What must I watch")
// matches; the capture group keeps the original-case object for display.
const SUGGESTION_SEQUENCE_PATTERNS: RegExp[] = [
  /\bpre-?requisites?\s+for\s+(.{3,})/i,
  /\bmust-(?:watch|read|play)\s+before\s+(.{3,})/i,
  /\bwhat\s+must\s+i\s+(?:watch|read|play)\s+before\s+(.{3,})/i,
  /\bwhat\s+should\s+i\s+(?:watch|read|play|install)\s+before\s+(.{3,})/i,
  /\bwhat\s+do\s+i\s+need\s+to\s+watch\s+before\s+(.{3,})/i,
  /\bwhich\s+should\s+i\s+watch\s+before\s+(.{3,})/i,
  /\bwhere\s+should\s+i\s+start\s+with\s+(.{3,})/i,
  /\bwhere\s+do\s+i\s+start\s+with\s+(.{3,})/i,
]

// External-object cue v0 (round-6 verdict + round-7 boundary matrix, 8/8): a
// title-like object (contains a colon) OR a closed auditable software-domain
// term (case-insensitive, whole-word). NO generic capitalization/proper-noun
// detector (the verdict forbids one — it would over-fire on "Good Desk Chair"
// titles, book club names, the site's own proper nouns). A software term not
// on the list → cue fails → no suggestion (the acceptable fallback; widen the
// list from prod miss-data).
const SOFTWARE_DOMAIN_TERMS = [
  "kubernetes", "docker", "containerd", "helm", "istio", "kafka", "redis",
  "postgres", "postgresql", "mysql", "mongodb", "elasticsearch", "nginx",
  "apache", "terraform", "ansible", "chef", "puppet", "prometheus", "grafana",
  "jenkins", "gitlab", "node", "npm", "yarn", "pnpm", "python", "pip", "java",
  "maven", "gradle", "kotlin", "swift", "rust", "cargo", "golang", "ruby",
  "rails", "php", "composer", "react", "nextjs", "next.js", "vue", "angular",
  "svelte", "aws", "azure", "gcp", "linux", "ubuntu", "debian", "macos",
  "windows",
]

// Currentness / reception / temporal language — the canonical external-
// current signal (a curated subset of the old YES_TEMPORAL list, minus the
// too-broad "did"/"said"/"who is" which are handled by attribution or are
// ambiguous). A currentness word on a non-site turn suggests
// current-public-facts. NOTERMS gate prevents "latest reviews of my blog".
const CURRENTNESS_TERMS = [
  "latest", "newest", "reviews", "review of", "release", "released",
  "after launch", "current", "what happened", "reception", "box office",
  "chart position", "rankings", "bestseller list",
]

// Attribution / quote patterns. "did X say" / "who said" / "is this quote
// real". Careful: bare "did " is too broad ("did you finish"); require a
// "say" anchor.
// Case-insensitive. The subject span uses `.` (not `\S`) so multi-word names
// ("Dan Koe", "Sam Altman") match; bounded + anchored on "say"/"said" so a
// bare "did you finish" (no say anchor) never matches.
const ATTRIBUTION_PATTERNS: RegExp[] = [
  /\b(?:did|does|didn'?t|didnt)\s+.{1,60}?\s+say\b/i,
  /\bwho\s+said\b/i,
  /\bis\s+this\s+quote\b/i,
  /\bquote\s+(?:real|genuine|accurate|fake|apocryphal)\b/i,
  /\bwhat\s+(?:has|did)\s+.{1,60}?\s+said\b/i,
  /\bsaid\s+about\b/i,
]

function termRegex(term: string): RegExp {
  // whole-word, case-insensitive; escape dots (next.js)
  return new RegExp(`\\b${term.replace(/\./g, "\\.")}\\b`, "i")
}
const SOFTWARE_TERM_REGEXES = SOFTWARE_DOMAIN_TERMS.map(termRegex)

/** External-object cue v0: title-like colon OR a closed software-domain term. */
function passesExternalObjectCue(object: string): boolean {
  if (object.includes(":")) return true
  for (const re of SOFTWARE_TERM_REGEXES) if (re.test(object)) return true
  return false
}

/** Clean a captured object into a display subject: trim, drop trailing
 *  punctuation, cap length. Best-effort, lexical only. */
function cleanSubject(raw: string): string {
  const s = raw
    .trim()
    .replace(/[?.!…,;:]+$/u, "")
    .trim()
  return s.length > 80 ? s.slice(0, 80).trim() + "…" : s
}

/** Best-effort subject extraction for currentness turns: "reviews of X",
 *  "latest X", "reviews for X", "reviews about X". null if not found. */
function extractCurrentnessSubject(message: string): string | null {
  const m =
    /\b(?:reviews?|latest|newest)\s+(?:of|for|about|on)\s+(.{3,}?)(?:[?.!]|$)/i.exec(
      message
    )
  if (m && m[1]) return cleanSubject(m[1])
  return null
}

/** The most recent web-verified external subject in history (B.3
 *  provenance): the subject of the latest assistant row whose web_research
 *  audit has a run with subjectMatch:true and a non-null subject. Read-only
 *  audit data — never memory, never re-fed to Mistral (rowToMistral skips
 *  web_research). Returns null if none in the recent window. */
function recentWebVerifiedSubject(
  historyRows: ChatMessageRow[]
): string | null {
  for (let i = historyRows.length - 1; i >= 0 && i >= historyRows.length - 8; i--) {
    const row = historyRows[i]
    const runs = row.web_research?.runs
    if (!runs) continue
    for (let j = runs.length - 1; j >= 0; j--) {
      const r = runs[j]
      if (r.subjectMatch && r.subject) return r.subject
    }
  }
  return null
}

/** A short factual follow-up: a brief message (≤240 chars) that isn't itself
 *  a greeting/creative line and reads as a factual probe about a prior
 *  subject. Conservative — provenance already established the external
 *  subject; this just checks the follow-up is a plausible factual turn, not
 *  a new unrelated instruction. */
function isShortFactualFollowup(message: string): boolean {
  const t = message.trim()
  if (!t || t.length > 240) return false
  // not a greeting / creative / preference line
  const lower = t.toLowerCase()
  if (NO_TERMS.some((n) => lower.includes(n))) return false
  if (/^(hi|hey|hello|thanks|thank you)\b/i.test(t)) return false
  if (/help me (draft|write)/i.test(t)) return false
  return true
}

/**
 * Detect whether this turn may benefit from external verification. Pure for
 * v1 — NO model call. Returns a suggestion (reason + best-effort subject) or
 * `{ suggested: false }`. The caller (route) surfaces an inline choice iff
 * `suggested`; explicit `/web`/`/noweb` are handled at the route BEFORE this
 * function, so it only sees `auto` turns.
 *
 * Precedence (first match wins):
 *  1. NOTERM hit → no suggestion (site controls win).
 *  2. B.3 provenance + short factual follow-up → recent-subject-follow-up.
 *  3. prereq/sequence pattern + external-object cue → external-prerequisites.
 *  4. attribution/quote pattern → attribution-or-quote.
 *  5. currentness/reception term (non-site) → current-public-facts.
 *  6. else → no suggestion (site-first synthesis).
 */
export function detectExternalVerificationNeed(
  message: string,
  historyRows: ChatMessageRow[] = []
): VerificationSuggestion {
  const t = ` ${message.toLowerCase().trim()} `

  // 1. Site-internal / suppression terms → site controls win, no suggestion.
  if (NO_TERMS.some((n) => t.includes(n))) return { suggested: false }

  // 2. B.3 provenance: a recently web-verified external subject + a short
  //    factual follow-up (e.g. "how are the reviews putting it in the canon?"
  //    after a searched establishment turn about The Odyssey). The follow-up
  //    is often anaphoric ("it"), so the subject comes from the audit row,
  //    not the message.
  const recentSubject = recentWebVerifiedSubject(historyRows)
  if (recentSubject && isShortFactualFollowup(message)) {
    return { suggested: true, reason: "recent-subject-follow-up", subject: recentSubject }
  }

  // 3. Prereq / sequence / starting pattern, gated by the external-object cue.
  //    The cue keeps advice ("prerequisites for a good desk chair") from
  //    suggesting while letting external software/titled works through.
  for (const re of SUGGESTION_SEQUENCE_PATTERNS) {
    const m = re.exec(message)
    if (m && m[1]) {
      const object = m[1]
      if (passesExternalObjectCue(object)) {
        return { suggested: true, reason: "external-prerequisites", subject: cleanSubject(object) }
      }
      // pattern matched but cue failed → do NOT suggest; fall through to the
      // other signals (a currentness word might still fire on the same turn).
      break
    }
  }

  // 4. Attribution / quote.
  if (ATTRIBUTION_PATTERNS.some((re) => re.test(message))) {
    return { suggested: true, reason: "attribution-or-quote", subject: null }
  }

  // 5. Currentness / reception (non-site — NOTERM already checked above).
  if (CURRENTNESS_TERMS.some((c) => t.includes(c))) {
    return {
      suggested: true,
      reason: "current-public-facts",
      subject: extractCurrentnessSubject(message),
    }
  }

  // 6. No suggestion → site-first synthesis (the user may still /web).
  return { suggested: false }
}