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

describe("classifyWebNeed — factual-frame lift (round 2)", () => {
  // The Kimi K3 false-negative: a bare factual question about a named external
  // entity with no temporal/version cue scored 0 → no-search → the mistral-small
  // tie-break never ran. A factual frame now lifts a suppressed no-search to
  // borderline so the classifier gets to judge it — never to auto-search.
  it("lifts a bare factual question with no temporal cue to borderline", () => {
    expect(classifyWebNeed("how good is the Kimi K3 model?").band).toBe("borderline")
    expect(classifyWebNeed("what is a mixture of experts?").band).toBe("borderline")
    expect(classifyWebNeed("tell me about Mistral Medium 3").band).toBe("borderline")
    expect(classifyWebNeed("summarize the Kimi K3 paper").band).toBe("borderline")
  })

  it("does NOT lift when a site-internal NO_TERM fires (explicit suppression)", () => {
    expect(classifyWebNeed("what is my shelf?").band).toBe("no-search")
    expect(classifyWebNeed("tell me about my bench").band).toBe("no-search")
    expect(classifyWebNeed("how good is the draft on my blog?").band).toBe("no-search")
  })

  it("does NOT lift a factual frame with no substantive remainder", () => {
    // remainder "up" < 3 chars → not lifted → stays no-search
    expect(classifyWebNeed("what is up").band).toBe("no-search")
  })

  it("does NOT downgrade a search-band question (temporal cues still win straight to search)", () => {
    // "latest" + "version" → +6 → search; the factual frame does not pull it back to borderline
    expect(classifyWebNeed("what is the latest version of Next.js").band).toBe("search")
  })

  it("lowercase model/product input reaches borderline (no capitalisation signal)", () => {
    expect(classifyWebNeed("how good is kimi k3?").band).toBe("borderline")
    expect(classifyWebNeed("what is kimi k3").band).toBe("borderline")
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

describe("decideWebEnabled — factual-frame borderline routing (round 2)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("invokes the classifier on a factual-frame question and respects a site-only verdict", async () => {
    // "tell me about this post" → factual frame → borderline → classifier says site-only.
    mistralMock.mistralTurn.mockResolvedValue({ content: "site-only", tool_calls: [] })
    const r = await decideWebEnabled("tell me about this post", [])
    expect(r.via).toBe("mistral-small")
    expect(mistralMock.mistralTurn).toHaveBeenCalledTimes(1)
    expect(r.decision).toBe("site-only")
    expect(r.webEnabled).toBe(false)
  })

  it("falls back to conservative no-search when the classifier fails on a factual-frame question", async () => {
    mistralMock.mistralTurn.mockRejectedValue(new Error("boom"))
    const r = await decideWebEnabled("how good is Kimi K3?", [])
    expect(r.via).toBe("mistral-small")
    expect(r.webEnabled).toBe(false)
    expect(r.decision).toBe("no-search")
  })

  it("does NOT auto-search a factual-frame question — the classifier decides", async () => {
    // Factual frame lifts to borderline; an unparsable classifier answer must
    // default to no-search, never to search.
    mistralMock.mistralTurn.mockResolvedValue({ content: "huh?", tool_calls: [] })
    const r = await decideWebEnabled("what is a mixture of experts?", [])
    expect(r.via).toBe("mistral-small")
    expect(r.webEnabled).toBe(false)
  })
})