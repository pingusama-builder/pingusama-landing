import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

const publicRoot = join(process.cwd(), "public", "portrait")
const atlasPath = join(publicRoot, "atlas.html")
const atlasHtml = existsSync(atlasPath) ? readFileSync(atlasPath, "utf8") : ""
const legacyPath = join(publicRoot, "atlas-night-ink-v2.html")

function containsAll(haystack: string, needles: string[]) {
  for (const needle of needles) {
    expect(haystack, `should contain ${needle}`).toContain(needle)
  }
}

describe("portrait atlas.html port", () => {
  test("preserves the previous canvas atlas as a time layer", () => {
    expect(existsSync(legacyPath)).toBe(true)
    const legacy = readFileSync(legacyPath, "utf8")
    expect(legacy).toContain("夜墨小圖志")
    expect(legacy).toContain("id=\"c\"")
  })

  test("hosts the accepted v2 workshop foundation", () => {
    containsAll(atlasHtml, [
      "atlas-motion-v1/foundation-v2.png",
      "atlas-motion-v1/pingu-v0-cutout.png",
      "atlas-motion-v1/pingu-turnaround.png",
    ])
  })

  test("keeps the Pingusama actor, threshold and closeup traces", () => {
    containsAll(atlasHtml, [
      'class="actor"',
      'class="work-pose"',
      'class="turn-pose"',
      'id="workshop-threshold"',
      'class="threshold"',
      'class="closeup-traces"',
      'class="thread-tail"',
    ])
  })

  test("wires the proven motion module as the invitation controller", () => {
    expect(atlasHtml).toContain('src="atlas-motion-v1.js"')
    expect(atlasHtml).toContain('data-phase="working"')
    expect(atlasHtml).toContain("prefers-reduced-motion: reduce")
  })

  test("preserves peer-room hotspots and links", () => {
    containsAll(atlasHtml, [
      'class="hotspots"',
      'class="hotspot',
      'href="/portrait/vn"',
      'href="/portrait/books"',
      'id="panel"',
      'class="panel"',
      "VN 舊驛",
      "藏書台",
      "燈工房",
      "不題名之門",
    ])
  })

  test("keeps the portrait-wide key legend", () => {
    expect(atlasHtml).toContain("此刻可見的 trace")
    expect(atlasHtml).toContain("暗處不是未解鎖")
  })

  test("does not introduce chatbot or companion behavior", () => {
    expect(atlasHtml.toLowerCase()).not.toContain("chatbot")
    expect(atlasHtml.toLowerCase()).not.toContain("companion")
  })

  test("keeps the standalone prototype untouched", () => {
    const prototypePath = join(publicRoot, "atlas-motion-v1.html")
    expect(existsSync(prototypePath)).toBe(true)
    const prototype = readFileSync(prototypePath, "utf8")
    expect(prototype).toContain("現在・工坊")
    expect(prototype).toContain('src="atlas-motion-v1.js"')
  })
})
