import { describe, it, expect } from "vitest"
import { parseDesignTokens, summarizeDesignTokens } from "@/lib/chat/design-tokens"

// The real :root block from app/globals.css (kept in sync by hand; the builder
// re-parses the live file, this just pins the parser contract).
const SAMPLE = `
:root {
  --bg:           #E8DCC4;
  --terracotta:   #C97B5C;
  --walnut:       #3E2C20;
  --font-display: var(--font-fraunces), Georgia, serif;
  --font-body:    var(--font-nunito), system-ui, sans-serif;
  --radius:       14px;
  --shadow:       0 2px 0 rgba(62,44,32,.08), 0 8px 24px rgba(62,44,32,.10);
}
body { color: var(--walnut); }
`

describe("parseDesignTokens", () => {
  it("buckets colors, fonts, radii, shadows correctly", () => {
    const t = parseDesignTokens(SAMPLE)
    const names = (arr: { name: string }[]) => arr.map((x) => x.name)
    expect(names(t.colors)).toEqual(["--bg", "--terracotta", "--walnut"])
    expect(names(t.fonts)).toEqual(["--font-display", "--font-body"])
    expect(names(t.radii)).toEqual(["--radius"])
    expect(names(t.shadows)).toEqual(["--shadow"])
    expect(t.other).toHaveLength(0)
  })

  it("keeps the real values, not just names", () => {
    const t = parseDesignTokens(SAMPLE)
    expect(t.colors.find((c) => c.name === "--terracotta")?.value).toBe("#C97B5C")
    expect(t.fonts.find((c) => c.name === "--font-display")?.value).toBe(
      "var(--font-fraunces), Georgia, serif"
    )
  })

  it("ignores non-token rules and is robust to a non-:root stylesheet", () => {
    const t = parseDesignTokens("body { color: red; } .x { --a: 1px; }")
    expect(t.colors).toHaveLength(0)
    expect(t.fonts).toHaveLength(0)
  })

  it("handles an empty / malformed input without throwing", () => {
    expect(() => parseDesignTokens("")).not.toThrow()
    expect(() => parseDesignTokens(":root { --no-colon }")).not.toThrow()
  })
})

describe("summarizeDesignTokens", () => {
  it("renders a compact markdown summary with all buckets", () => {
    const s = summarizeDesignTokens(parseDesignTokens(SAMPLE))
    expect(s).toContain("### Colors")
    expect(s).toContain("--terracotta: #C97B5C")
    expect(s).toContain("### Fonts")
    expect(s).toContain("--font-display:")
    expect(s).toContain("### Radii")
    expect(s).toContain("### Shadows")
  })
  it("falls back to a placeholder when there are no tokens", () => {
    expect(summarizeDesignTokens(parseDesignTokens(""))).toMatch(/No design tokens/)
  })
})