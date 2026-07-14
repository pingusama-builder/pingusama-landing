import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  mergeWebResearch,
  rankSources,
  formatWebEvidenceGuarded,
  subjectInSources,
  type WebResearch,
} from "@/lib/chat/tavily-search"

const dir = fileURLToPath(new URL("../fixtures/web-search-eval", import.meta.url))

interface Fixture {
  name: string
  rewrite: { queries: string[]; subject: string | null }
  studies: WebResearch[]
  expectGuard: boolean
  expectReadFull: boolean
}

function load(file: string): Fixture {
  return JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as Fixture
}

describe("web-search eval corpus (pure merge/rank/guard logic)", () => {
  for (const file of readdirSync(dir)) {
    const fx = load(file)
    it(`${fx.name}: guard=${fx.expectGuard}, readFull=${fx.expectReadFull}`, () => {
      const merged = mergeWebResearch(fx.studies)
      const ranked = rankSources(merged.sources, fx.rewrite.subject)
      const match = subjectInSources({ ...merged, sources: ranked }, fx.rewrite.subject)
      const guardFires = !!fx.rewrite.subject && !match
      expect(guardFires).toBe(fx.expectGuard)

      // When the guard does NOT fire and a readFull path is expected, a page for
      // the top source produces a READ-IN-FULL section. When the guard fires,
      // no extracted text is offered (the page is suppressed too).
      const pages =
        fx.expectReadFull && ranked[0]
          ? [{ url: ranked[0].url, content: "extracted page text mentioning the subject" }]
          : []
      const block = formatWebEvidenceGuarded({ ...merged, sources: ranked }, fx.rewrite.subject, pages)
      if (fx.expectGuard) {
        expect(block).toMatch(/NONE of them mention/)
        expect(block).not.toMatch(/READ IN FULL/)
      } else if (fx.expectReadFull) {
        expect(block).toMatch(/READ IN FULL/)
      }
    })
  }
})