// Pure parser for the site's CSS design tokens (the `:root { --… }` block in
// app/globals.css). Lives here — separate from the build-code-map SCRIPT — so it
// can be unit-tested and reused. The chatbot uses the parsed tokens so it knows
// the ACTUAL palette/type/radii rather than guessing from component names.

export interface DesignToken {
  name: string
  value: string
}

export interface DesignTokens {
  colors: DesignToken[]
  fonts: DesignToken[]
  radii: DesignToken[]
  shadows: DesignToken[]
  other: DesignToken[]
}

const COLOR_VALUE = /^\s*(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|color-mix\()/

function classify(name: string, value: string): keyof DesignTokens {
  if (name.includes("font")) return "fonts"
  if (name.includes("radiu") || name.includes("radii")) return "radii"
  if (name.includes("shadow")) return "shadows"
  if (COLOR_VALUE.test(value)) return "colors"
  return "other"
}

/**
 * Parse every `--token: value;` declaration out of the first `:root { … }` block
 * (and any other `:root` blocks in the file) and bucket them. Unknown or
 * malformed lines are skipped; it never throws.
 */
export function parseDesignTokens(css: string): DesignTokens {
  const out: DesignTokens = { colors: [], fonts: [], radii: [], shadows: [], other: [] }
  // Match `:root { … }` blocks (non-greedy, brace-matched one level deep).
  const blockRe = /:root\s*\{([^}]*)\}/g
  let block: RegExpExecArray | null
  while ((block = blockRe.exec(css))) {
    for (const raw of block[1].split(/;/)) {
      const line = raw.trim()
      if (!line.startsWith("--")) continue
      const col = line.indexOf(":")
      if (col < 0) continue
      const name = line.slice(0, col).trim()
      const value = line.slice(col + 1).trim()
      if (!name || !value) continue
      const key = classify(name, value)
      out[key].push({ name, value })
    }
  }
  return out
}

/** A compact, LLM-friendly markdown summary of the design system. */
export function summarizeDesignTokens(tokens: DesignTokens): string {
  const fmt = (t: DesignToken) => `- ${t.name}: ${t.value}`
  const parts: string[] = []
  if (tokens.colors.length) parts.push(`### Colors\n${tokens.colors.map(fmt).join("\n")}`)
  if (tokens.fonts.length) parts.push(`### Fonts\n${tokens.fonts.map(fmt).join("\n")}`)
  if (tokens.radii.length) parts.push(`### Radii\n${tokens.radii.map(fmt).join("\n")}`)
  if (tokens.shadows.length) parts.push(`### Shadows\n${tokens.shadows.map(fmt).join("\n")}`)
  if (tokens.other.length) parts.push(`### Other\n${tokens.other.map(fmt).join("\n")}`)
  return parts.join("\n\n") || "_No design tokens found._"
}