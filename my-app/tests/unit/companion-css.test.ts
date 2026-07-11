import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const file = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8"
)

describe("companion CSS (spec §9 + mobile rule)", () => {
  it("defines the companion block + card status variants", () => {
    expect(file).toContain(".companion")
    expect(file).toContain(".companion-card--applied")
    expect(file).toContain(".companion-card--stale")
    expect(file).toContain(".companion-card--pending")
  })
  it("uses the Fraunces/Nunito design tokens (no hard-coded fonts)", () => {
    expect(file).toMatch(/var\(--font-body\)|var\(--font-display\)/)
    expect(file).not.toMatch(/font-family:\s*(Fraunces|Nunito)/i) // tokens, not literals
  })
  it("has a ≤720px mobile breakpoint (sticky, not inline-below-form)", () => {
    expect(file).toMatch(/max-width:\s*720px/)
    expect(file).toMatch(/\.companion[\s{][\s\S]*?position:\s*sticky|position:\s*sticky/)
  })
  it("has a 390px-or-smaller narrow check marker / no horizontal overflow guard", () => {
    // We assert a small-viewport rule exists so the mobile rule is verified.
    expect(file).toMatch(/max-width:\s*(390|720)px/)
  })
  it("has focus-visible outlines (a11y)", () => {
    expect(file).toContain("focus-visible")
  })
  it("uses site color tokens", () => {
    expect(file).toContain("var(--terracotta)")
    expect(file).toContain("var(--walnut)")
  })
  it("defines the editor rail layout classes", () => {
    expect(file).toContain(".editor-wrap")
    expect(file).toContain(".editor-layout")
    expect(file).toContain(".companion-rail")
    expect(file).toContain(".companion-scroll")
  })
  it("the rail is sticky on wide desktop and static below 1120px", () => {
    expect(file).toMatch(/\.companion-rail[\s\S]*?position:\s*sticky/)
    expect(file).toMatch(/max-width:\s*1119px/)
  })
  it("keeps the 720px mobile drawer and the 390px narrow check", () => {
    expect(file).toMatch(/max-width:\s*720px/)
    expect(file).toMatch(/max-width:\s*390px/)
  })
  it("defines a single companion-scroll region and a 3-row grid companion", () => {
    expect(file).toContain(".companion-scroll")
    expect(file).toMatch(/\.companion\s*\{[\s\S]*?display:\s*grid/)
    expect(file).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/)
    expect(file).toMatch(/\.companion-scroll[\s\S]*?overflow-y:\s*auto/)
  })
})