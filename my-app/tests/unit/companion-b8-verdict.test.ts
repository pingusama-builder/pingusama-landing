import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const route = readFileSync(
  fileURLToPath(new URL("../../app/api/blog-companion/route.ts", import.meta.url)),
  "utf8"
)

const comp = readFileSync(
  fileURLToPath(new URL("../../components/BlogCompanion.tsx", import.meta.url)),
  "utf8"
)

describe("blog-companion route — Mistral full-review cap (advisor §B8 Q3)", () => {
  it("raises the per-turn default from 800 to 1200", () => {
    expect(route).toContain("Number(process.env.COMPANION_MAX_TOKENS) || 1200")
    expect(route).not.toContain("Number(process.env.COMPANION_MAX_TOKENS) || 800")
  })
  it("keeps the final-guess cap at 1200 (not doubled)", () => {
    expect(route).toContain("Number(process.env.COMPANION_MAX_TOKENS_FINAL) || 1200")
  })
  it("documents the cap as a Mistral-specific operational test (B8 Q3)", () => {
    expect(route).toMatch(/B8|phase B8|advisor.*Q3/i)
  })
})

describe("BlogCompanion.tsx — basis-ID authority calibration (advisor §B8 Q4)", () => {
  it("does not render the principle/craft-note badge on author-facing cards", () => {
    expect(comp).not.toContain("companion-card-principle")
    expect(comp).not.toContain("craftNote(")
  })
  it("keeps the CRAFT_NOTE_LABELS map for telemetry (not author-facing)", () => {
    expect(comp).toContain("CRAFT_NOTE_LABELS")
  })
})

describe("blog-companion route — blind-isolation memory condition (advisor §B8 cross-draft matrix)", () => {
  it("gates a memory-suppression switch on COMPANION_BLIND_REVIEW (dormant when unset)", () => {
    expect(route).toContain("COMPANION_BLIND_REVIEW")
    // The suppression is a mechanical input guard (empty array when set), not a
    // prompt clause asking the model to ignore memory.
    expect(route).toContain("process.env.COMPANION_BLIND_REVIEW ? [] : memories")
  })
  it("documents it as dormant unless the env is set", () => {
    expect(route).toMatch(/Dormant when unset/)
  })
})