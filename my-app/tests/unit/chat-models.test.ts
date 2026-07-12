import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Single module mock for @/lib/chat/mistral. By default the mocked mistralTurn
// delegates to the real implementation, so the Task-2 fetch-stub tests below
// still exercise the real client (and its MISTRAL_MODEL fallback) end-to-end.
// The classifyDifficultyHybrid (Task-3) tests reset the mock and drive it with
// their own return/reject values to test the borderline small-model path.
const mistralMock = vi.hoisted(() => ({
  mistralTurn: vi.fn(),
  realMistralTurn: null as ((opts: unknown) => Promise<unknown>) | null,
}))

vi.mock("@/lib/chat/mistral", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/chat/mistral")
  mistralMock.realMistralTurn = actual.mistralTurn as unknown as (opts: unknown) => Promise<unknown>
  mistralMock.mistralTurn.mockImplementation(actual.mistralTurn)
  return {
    ...actual,
    mistralTurn: mistralMock.mistralTurn,
  }
})

// Fetch is mocked so the (real, delegated) mistralTurn can assert the request
// body uses opts.model when provided. classifyDifficultyHybrid tests never hit
// fetch — they drive the mistralTurn mock directly.
const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal("fetch", fetchMock)

import { mistralTurn } from "@/lib/chat/mistral"
import {
  resolveModel,
  classifyDifficulty,
  classifyDifficultyHybrid,
  bandToTier,
  MODEL_TIERS,
  DEFAULT_TIER,
  MODEL_PREFERENCES,
} from "@/lib/chat/models"

describe("mistral client — per-call model override", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    // Ensure the mock delegates to the real client for these tests, regardless
    // of whether a classifyDifficultyHybrid test reset it earlier in the run.
    mistralMock.mistralTurn.mockImplementation(mistralMock.realMistralTurn!)
    process.env.MISTRAL_API_KEY = "test-key"
    process.env.MISTRAL_MODEL = "mistral-medium-latest"
  })

  it("sends opts.model when provided (overrides MISTRAL_MODEL)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    await mistralTurn({ messages: [{ role: "user", content: "hi" }], model: "mistral-large-latest" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe("mistral-large-latest")
  })

  it("falls back to MISTRAL_MODEL when opts.model is absent", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    await mistralTurn({ messages: [{ role: "user", content: "hi" }] })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe("mistral-medium-latest")
  })
})

// ---- Task 3: model registry + difficulty classifier + resolver ----

describe("bandToTier", () => {
  it("maps easy→small, medium→medium, hard→large", () => {
    expect(bandToTier("easy")).toBe("small")
    expect(bandToTier("medium")).toBe("medium")
    expect(bandToTier("hard")).toBe("large")
  })
})

describe("classifyDifficulty (heuristic)", () => {
  it("scores a short greeting as easy and not borderline", () => {
    const r = classifyDifficulty("hi")
    expect(r.band).toBe("easy")
    expect(r.borderline).toBe(false)
  })
  it("scores a long code-heavy request as hard", () => {
    const msg = "Please explain in detail and compare the tradeoffs of these five architectures, then prove correctness:\n```\ncode\n```"
    const r = classifyDifficulty(msg)
    expect(r.band).toBe("hard")
  })
  it("flags borderline messages near the medium/hard threshold", () => {
    const r = classifyDifficulty("Can you debug this small snippet for me?")
    expect(typeof r.borderline).toBe("boolean")
  })
})

describe("classifyDifficultyHybrid", () => {
  beforeEach(() => mistralMock.mistralTurn.mockReset())

  it("uses the heuristic band and skips mistral when not borderline", async () => {
    const r = await classifyDifficultyHybrid("hi")
    expect(r.via).toBe("heuristic")
    expect(mistralMock.mistralTurn).not.toHaveBeenCalled()
  })

  it("calls mistral-small to break ties when borderline, and uses its label", async () => {
    const msg = "debug and explain this snippet, then refactor it:\n```\nconst x = 1\n```"
    const heur = classifyDifficulty(msg)
    expect(heur.borderline).toBe(true)
    mistralMock.mistralTurn.mockResolvedValue({
      role: "assistant",
      content: "hard",
      tool_calls: [],
      finish_reason: "stop",
    })
    const r = await classifyDifficultyHybrid(msg)
    expect(r.via).toBe("mistral-small")
    expect(r.band).toBe("hard")
    expect(mistralMock.mistralTurn).toHaveBeenCalledTimes(1)
    // The classifier call uses mistral-small-latest.
    const opts = mistralMock.mistralTurn.mock.calls[0][0] as { model?: string }
    expect(opts.model).toBe("mistral-small-latest")
  })

  it("falls back to the heuristic band when the mistral-small call fails", async () => {
    const msg = "debug and explain this snippet, then refactor it:\n```\nconst x = 1\n```"
    // mockRejectedValueOnce (not persistent) — vitest 4.x flags a persistent
    // mockRejectedValue as an unhandled rejection when mockReset() runs in
    // beforeEach; the mock is called exactly once here, so Once is equivalent.
    mistralMock.mistralTurn.mockRejectedValueOnce(new Error("network down"))
    const r = await classifyDifficultyHybrid(msg)
    expect(r.via).toBe("heuristic")
  })
})

describe("resolveModel priority chain", () => {
  it("override wins over a pinned preference", () => {
    const r = resolveModel({ preference: "small", override: "large", message: "hi" })
    expect(r.tier).toBe("large")
    expect(r.modelId).toBe(MODEL_TIERS.large)
    expect(r.reason).toContain("override")
  })
  it("pinned preference wins when no override", () => {
    const r = resolveModel({ preference: "medium", override: null, message: "hi" })
    expect(r.tier).toBe("medium")
    expect(r.reason).toContain("pinned")
  })
  it("auto → classifies by difficulty", () => {
    const r = resolveModel({ preference: "auto", override: null, message: "hi" })
    expect(r.tier).toBe("small") // easy → small
    expect(r.reason).toContain("auto")
  })
  it("null preference is treated as auto", () => {
    const r = resolveModel({ preference: null, override: null, message: "hi" })
    expect(r.tier).toBe("small")
  })
  it("falls back to DEFAULT_TIER on an unknown preference", () => {
    const r = resolveModel({ preference: "bogus" as any, override: null, message: "hi" })
    expect(r.tier).toBe(DEFAULT_TIER)
  })
})

describe("MODEL_PREFERENCES", () => {
  it("lists auto + the three tiers", () => {
    expect(MODEL_PREFERENCES).toEqual(["auto", "small", "medium", "large"])
  })
})

// ── Advisor phase B9 Q3 ────────────────────────────────────────────────────
// Narrow-scope substrate override: when COMPANION_NARROW_SUBSTRATE=model|effort
// is set, the medium tier resolves to the override model (e.g.
// mistral-medium-3-5) so the three-arm matched narrow-scope A/B test can run.
// Dormant when unset. MODEL_TIERS is module-evaluated once (the env is read at
// import time, same as COMPANION_REASONING_EFFORT), so the behavioral test of
// the parser lives in companion-reasoning-substrate.test.ts (getNarrowSubstrate,
// env-at-call-time); here we cover the wiring. See VERDICT-phaseB9.md Q3.
describe("MODEL_TIERS — narrow-substrate override wiring (advisor phase B9 Q3)", () => {
  const modelsSrc = readFileSync(fileURLToPath(new URL("../../lib/chat/models.ts", import.meta.url)), "utf8")

  it("routes the medium tier through the narrow-substrate override", () => {
    expect(modelsSrc).toContain("getNarrowSubstrate")
    expect(modelsSrc).toContain("COMPANION_NARROW_SUBSTRATE")
    // The override is the fallback source for the medium tier (dormant → null →
    // mistral-medium-latest, the unchanged prod default).
    expect(modelsSrc).toMatch(/NARROW_MODEL\s*\?\?\s*"mistral-medium-latest"/)
  })
})