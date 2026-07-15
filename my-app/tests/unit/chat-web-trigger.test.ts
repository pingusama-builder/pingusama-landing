import { describe, it, expect, vi, beforeEach } from "vitest"

const mistralMock = vi.hoisted(() => ({ mistralTurn: vi.fn() }))
vi.mock("@/lib/chat/mistral", () => ({
  mistralTurn: mistralMock.mistralTurn,
  getReasoningModel: () => "mistral-medium-3-5",
  reasoningEffortForModel: () => undefined,
}))
vi.mock("@/lib/chat/models", () => ({
  MODEL_TIERS: {
    small: "mistral-small-latest",
    medium: "mistral-medium-latest",
    large: "mistral-large-latest",
  },
}))

import {
  classifyWebNeed,
  parseWebDecision,
  decideWebEnabled,
} from "@/lib/chat/web-trigger"

describe("classifyWebNeed (pure heuristic)", () => {
  it("greetings → no-search band", () => {
    expect(classifyWebNeed("hi there!").band).toBe("no-search")
    expect(classifyWebNeed("hey").band).toBe("no-search")
  })
  it("site-internal → no-search band", () => {
    expect(classifyWebNeed("what's on my bench right now?").band).toBe("no-search")
    expect(classifyWebNeed("add this book to my shelf").band).toBe("no-search")
    expect(classifyWebNeed("what does my vault have?").band).toBe("no-search")
  })
  it("fresh external factual → search band", () => {
    expect(classifyWebNeed("what has Dan Koe said about AI in 2025?").band).toBe("search")
    expect(classifyWebNeed("latest version of Next.js?").band).toBe("search")
    expect(classifyWebNeed("did Sam Altman say anything about AGI in 2026?").band).toBe(
      "search"
    )
  })
  it("creative/writing request → no-search band", () => {
    expect(classifyWebNeed("help me draft a blog intro about terracotta").band).toBe(
      "no-search"
    )
  })
  it("personal preference capture → no-search band", () => {
    expect(classifyWebNeed("i prefer walnut over terracotta now").band).toBe("no-search")
  })
})

describe("parseWebDecision", () => {
  it("parses the three labels", () => {
    expect(parseWebDecision("search")).toBe("search")
    expect(parseWebDecision("no-search")).toBe("no-search")
    expect(parseWebDecision("site-only")).toBe("site-only")
  })
  it("returns null on an unrecognized label", () => {
    expect(parseWebDecision("maybe")).toBe(null)
  })
})

describe("decideWebEnabled", () => {
  beforeEach(() => vi.clearAllMocks())

  it("uses heuristic (no model call) on a clear search case", async () => {
    const r = await decideWebEnabled("what has Dan Koe said about AI in 2025?", [])
    expect(r.webEnabled).toBe(true)
    expect(r.via).toBe("heuristic")
    expect(mistralMock.mistralTurn).not.toHaveBeenCalled()
  })

  it("uses heuristic on a clear no-search case", async () => {
    const r = await decideWebEnabled("hi", [])
    expect(r.webEnabled).toBe(false)
    expect(r.via).toBe("heuristic")
    expect(mistralMock.mistralTurn).not.toHaveBeenCalled()
  })

  it("calls mistral-small only on borderline", async () => {
    mistralMock.mistralTurn.mockResolvedValue({ content: "search", tool_calls: [] })
    // Borderline: external-sounding ("who is the author") but no strong temporal cue.
    const r = await decideWebEnabled("who is the author of that essay", [])
    expect(r.via).toBe("mistral-small")
    expect(mistralMock.mistralTurn).toHaveBeenCalledTimes(1)
  })

  it("falls back to heuristic band when the small call is unparsable", async () => {
    mistralMock.mistralTurn.mockResolvedValue({ content: "huh?", tool_calls: [] })
    const r = await decideWebEnabled("who is the author of that essay", [])
    expect(r.via).toBe("mistral-small")
    expect(typeof r.webEnabled).toBe("boolean")
  })

  it("never throws when the small call rejects", async () => {
    mistralMock.mistralTurn.mockRejectedValue(new Error("boom"))
    const r = await decideWebEnabled("who is the author of that essay", [])
    expect(r.via).toBe("mistral-small")
    expect(typeof r.webEnabled).toBe("boolean")
  })
})