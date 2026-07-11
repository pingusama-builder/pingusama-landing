import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const file = readFileSync(
  fileURLToPath(new URL("../../components/ChatUI.tsx", import.meta.url)),
  "utf8"
)

describe("ChatUI.tsx — safe markdown rendering of assistant output", () => {
  it("renders assistant message bodies via the safe MarkdownText renderer", () => {
    expect(file).toContain("MarkdownText")
  })

  it("never uses dangerouslySetInnerHTML on model output", () => {
    expect(file).not.toContain("dangerouslySetInnerHTML")
  })
})