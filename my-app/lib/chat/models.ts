// Model registry + difficulty routing for the companion.
// Resolves which Mistral model answers a turn: a one-turn override wins,
// then a pinned per-thread preference, then difficulty-based auto-routing
// on `auto`, then the default tier. The hybrid classifier scores a message
// with a cheap heuristic and only spends a mistral-small call when the
// score lands in a borderline band.

import { mistralTurn, getNarrowSubstrate } from "@/lib/chat/mistral"

export type ModelTier = "small" | "medium" | "large"
export type ModelPreference = "auto" | ModelTier
export type DifficultyBand = "easy" | "medium" | "hard"

// Advisor phase B8 Q7 substrate check: when OLLAMA_MODEL is set, every tier
// resolves to the local Ollama tag (e.g. glm5.2) so the route's reported modelId
// (surfaced to the UI via the { type: "model" } SSE event) and the model sent
// to the client both reflect the actual reasoning model in use. When unset,
// the Mistral tier map is unchanged. This mirrors the client-side coercion in
// lib/chat/mistral.ts (which also forces the request model to OLLAMA_MODEL
// regardless of the per-call model id).
const OLLAMA_MODEL = process.env.OLLAMA_MODEL

// Advisor phase B8 Q7 substrate check (Mistral in-place reasoning, option 2
// Path A): when COMPANION_REASONING_EFFORT is set, the full-review tier
// (`large`) is rerouted to a reasoning-capable Mistral model (default
// `mistral-medium-3-5`; override via MISTRAL_REASONING_MODEL). small/medium are
// left on the non-reasoning Mistral map so the root-level `reasoning_effort`
// param (sent by lib/chat/mistral.ts via isReasoningModel) never reaches a
// model that rejects it (mistral-medium-latest, mistral-large-latest). Dormant
// when unset — the production Mistral path is identical to before. Ollama
// (OLLAMA_MODEL) takes precedence over this substrate. See
// ai-advisor/refinement-03-fiction-examples-extension/eval/lane-decision-research.md.
const COMPANION_REASONING_EFFORT = process.env.COMPANION_REASONING_EFFORT
const MISTRAL_REASONING_MODEL = process.env.MISTRAL_REASONING_MODEL || "mistral-medium-3-5"

// Advisor phase B9 Q3 — narrow-scope substrate override. When
// COMPANION_NARROW_SUBSTRATE=model|effort is set (e.g. "mistral-medium-3-5|high"
// or "mistral-medium-3-5|none"), the medium tier resolves to `model` so the
// three-arm matched narrow-scope A/B test (baseline mistral-medium-latest /
// 3.5+high / 3.5+none) can run with no prompt, tool, cap, or security change.
// lib/chat/mistral.ts sends the matching `effort` as reasoning_effort for that
// model. Dormant when unset (null) → medium stays mistral-medium-latest, the
// unchanged prod default. Read once at module eval (same pattern as the other
// substrate env reads); the parser itself is env-at-call-time and unit-tested
// in companion-reasoning-substrate.test.ts. See VERDICT-phaseB9.md Q3.
const NARROW_MODEL = getNarrowSubstrate()?.model

export const MODEL_TIERS: Record<ModelTier, string> = OLLAMA_MODEL
  ? { small: OLLAMA_MODEL, medium: OLLAMA_MODEL, large: OLLAMA_MODEL }
  : COMPANION_REASONING_EFFORT
    ? {
        small: "mistral-small-latest",
        medium: NARROW_MODEL ?? "mistral-medium-latest",
        large: MISTRAL_REASONING_MODEL,
      }
    : {
        small: "mistral-small-latest",
        medium: NARROW_MODEL ?? "mistral-medium-latest",
        large: "mistral-large-latest",
      }

export const DEFAULT_TIER: ModelTier = "medium"

export const MODEL_PREFERENCES: ModelPreference[] = ["auto", "small", "medium", "large"]

// Difficulty verbs that push a message toward harder bands.
const HARD_VERBS = ["explain", "compare", "architect", "prove", "debug", "refactor", "design", "analyze", "derive"]
const MEDIUM_VERBS = ["why", "how", "tradeoff", "review", "outline", "summarize"]

// Band score thresholds. The borderline band straddles the medium/hard line.
const EASY_MAX = 6
const MEDIUM_MAX = 14
const BORDERLINE_LO = 10 // below this → not borderline (clearly easy or medium)
const BORDERLINE_HI = 18 // above this → not borderline (clearly hard)

export function bandToTier(band: DifficultyBand): ModelTier {
  if (band === "easy") return "small"
  if (band === "hard") return "large"
  return "medium"
}

export function classifyDifficulty(message: string): {
  score: number
  band: DifficultyBand
  borderline: boolean
} {
  const text = message.toLowerCase()
  let score = 0

  // Length signal.
  const len = message.length
  if (len > 120) score += 4
  if (len > 400) score += 4
  if (len > 900) score += 4

  // Code blocks / inline code push toward harder.
  if (/```/.test(message)) score += 5
  if (/`[^`]+`/.test(message)) score += 1

  // Multi-step verbs.
  for (const v of HARD_VERBS) if (text.includes(v)) score += 3
  for (const v of MEDIUM_VERBS) if (text.includes(v)) score += 2

  // Multi-part requests ("then", "and then", numbered lists).
  if (/\bthen\b/.test(text)) score += 2
  if (/\b\d+\.\s/.test(text)) score += 2 // numbered steps

  let band: DifficultyBand
  if (score <= EASY_MAX) band = "easy"
  else if (score <= MEDIUM_MAX) band = "medium"
  else band = "hard"

  const borderline = score >= BORDERLINE_LO && score <= BORDERLINE_HI
  return { score, band, borderline }
}

/** Parse a difficulty label out of a small-model response. */
function parseBand(raw: string): DifficultyBand | null {
  const t = raw.toLowerCase()
  if (t.includes("easy")) return "easy"
  if (t.includes("hard")) return "hard"
  if (t.includes("medium")) return "medium"
  return null
}

export async function classifyDifficultyHybrid(message: string): Promise<{
  band: DifficultyBand
  via: "heuristic" | "mistral-small"
}> {
  const h = classifyDifficulty(message)
  if (!h.borderline) return { band: h.band, via: "heuristic" }
  try {
    const acc = await mistralTurn({
      model: MODEL_TIERS.small,
      messages: [
        {
          role: "system",
          content:
            "You classify the difficulty of a user's request for a chat assistant. Reply with exactly one word: easy, medium, or hard. easy = quick factual/greeting; medium = a focused explanation or single debug; hard = multi-step design, compare, prove, or long code-heavy tasks.",
        },
        { role: "user", content: message.slice(0, 1000) },
      ],
      maxTokens: 8,
    })
    const label = parseBand(acc.content)
    if (label) return { band: label, via: "mistral-small" }
    return { band: h.band, via: "heuristic" } // unparsable → trust heuristic
  } catch {
    return { band: h.band, via: "heuristic" } // never block the turn
  }
}

export function resolveModel(opts: {
  preference?: ModelPreference | null
  override?: ModelTier | null
  message: string
}): { tier: ModelTier; modelId: string; reason: string } {
  const override = opts.override ?? null
  if (override && (override === "small" || override === "medium" || override === "large")) {
    return { tier: override, modelId: MODEL_TIERS[override], reason: `override (${override})` }
  }
  const pref = opts.preference ?? "auto"
  if (pref === "small" || pref === "medium" || pref === "large") {
    return { tier: pref, modelId: MODEL_TIERS[pref], reason: `pinned (${pref})` }
  }
  if (pref === "auto") {
    // Synchronous path is unavailable (the hybrid classifier is async); resolveModel
    // uses the pure heuristic for auto so the resolver stays sync. The route calls
    // classifyDifficultyHybrid directly on the auto path and passes the resolved tier
    // back in via the override mechanism (see route pipeline).
    const h = classifyDifficulty(opts.message)
    const tier = bandToTier(h.band)
    return { tier, modelId: MODEL_TIERS[tier], reason: `auto → ${tier} (heuristic)` }
  }
  // Unknown preference → default.
  return { tier: DEFAULT_TIER, modelId: MODEL_TIERS[DEFAULT_TIER], reason: `default (${DEFAULT_TIER})` }
}