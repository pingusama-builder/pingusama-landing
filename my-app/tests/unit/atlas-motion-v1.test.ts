import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"

const publicRoot = join(process.cwd(), "public", "portrait")
const prototypePath = join(publicRoot, "atlas-motion-v1.html")
const prototype = existsSync(prototypePath)
  ? readFileSync(prototypePath, "utf8")
  : ""
const motionModulePath = join(publicRoot, "atlas-motion-v1.js")
const motionScript = existsSync(motionModulePath)
  ? readFileSync(motionModulePath, "utf8")
  : ""
const motionModule = existsSync(motionModulePath)
  ? await import(pathToFileURL(motionModulePath).href)
  : null

function readPngSize(path: string) {
  const png = readFileSync(path)
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  }
}

describe("portrait atlas motion prototype", () => {
  test("starts at work only for a first-session motion-capable visitor", () => {
    expect(motionModule?.getInitialInvitationState).toBeTypeOf("function")
    const getInitialInvitationState = motionModule!.getInitialInvitationState

    expect(
      getInitialInvitationState({ reducedMotion: false, seenThisSession: false }),
    ).toBe("working")
    expect(
      getInitialInvitationState({ reducedMotion: true, seenThisSession: false }),
    ).toBe("threshold")
    expect(
      getInitialInvitationState({ reducedMotion: false, seenThisSession: true }),
    ).toBe("threshold")
  })

  test("maps the locked invitation timing to discrete motion-blocking phases", () => {
    expect(motionModule?.phaseForElapsed).toBeTypeOf("function")
    const phaseForElapsed = motionModule!.phaseForElapsed

    expect(phaseForElapsed(0)).toBe("working")
    expect(phaseForElapsed(2_999)).toBe("working")
    expect(phaseForElapsed(3_000)).toBe("notice")
    expect(phaseForElapsed(3_300)).toBe("quarter")
    expect(phaseForElapsed(3_550)).toBe("side")
    expect(phaseForElapsed(3_800)).toBe("walking")
    expect(phaseForElapsed(5_700)).toBe("threshold")
  })

  test("keeps the prototype standalone and wires the locked assets and affordances", () => {
    expect(existsSync(prototypePath)).toBe(true)
    expect(prototype).toContain("atlas-motion-v1/foundation-v2.png")
    expect(prototype).toContain("atlas-motion-v1/pingu-v0-cutout.png")
    expect(prototype).toContain("atlas-motion-v1/pingu-turnaround.png")
    expect(prototype).toContain('id="workshop-threshold"')
    expect(prototype).toContain("prefers-reduced-motion: reduce")
    expect(motionScript).toContain("portrait-atlas-invitation-seen-v1")
    expect(prototype).not.toContain("chatbot")
  })

  test("stores every derived bitmap beside the standalone prototype", () => {
    const assetRoot = join(publicRoot, "atlas-motion-v1")

    for (const asset of [
      "foundation-v2.png",
      "pingu-v0-cutout.png",
      "pingu-turnaround.png",
    ]) {
      expect(existsSync(join(assetRoot, asset)), asset).toBe(true)
    }
  })

  test("normalizes the four turn poses to a shared cropped baseline", () => {
    const turnaround = join(
      publicRoot,
      "atlas-motion-v1",
      "pingu-turnaround.png",
    )

    expect(readPngSize(turnaround)).toEqual({ width: 1536, height: 720 })
  })
})
