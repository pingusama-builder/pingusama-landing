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
// post-read imports @/lib/db/posts (getPosts/getPublishedPostBySlug); only the
// pure detectPostReviewIntent is used here, so stub the DB module to keep this a
// routing-only test (no @/lib/supabase/server or next/headers in the graph).
vi.mock("@/lib/db/posts", () => ({
  getPosts: vi.fn(),
  getPublishedPostBySlug: vi.fn(),
}))

import {
  classifyWebNeed,
  parseWebDecision,
  decideWebEnabled,
} from "@/lib/chat/web-trigger"
import { detectPostReviewIntent } from "@/lib/chat/post-read"

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

describe("classifyWebNeed — external-info frame lift (round 3)", () => {
  // The Spider-Man thread false-negative: factual external-entity questions
  // phrased as prerequisite / recommendation / expansion requests matched no
  // round-2 factual frame and hit no temporal cue → score 0 → no-search → the
  // classifier never ran → wrong latent-knowledge first answers. The new
  // EXTERNAL_INFO_FRAMES family lifts these to `borderline` so the existing
  // mistral-small classifier judges them — never direct to `search`.

  it("lifts the Spider-Man prerequisite turn to borderline", () => {
    expect(
      classifyWebNeed(
        "which are the absolute minimum must-watch pre-requisites for a non-Marvel fan who wants to watch and understand/follow at least 90% of Spiderman Brand New Day?"
      ).band
    ).toBe("borderline")
  })

  it("lifts the 'where do you expand from there' expansion turn to borderline", () => {
    expect(
      classifyWebNeed(
        "and where do you expand from there into other movies with Spiderman's meaningful involvement?"
      ).band
    ).toBe("borderline")
  })

  it("lifts 'Where should I start with One Piece?' to borderline", () => {
    expect(classifyWebNeed("Where should I start with One Piece?").band).toBe("borderline")
  })

  it("lifts 'Recommend a chair for my desk' to borderline (classifier may still no-search)", () => {
    // "my desk" is NOT a NO_TERM (only my bench/shelf/vault/blog are), so the
    // recommend frame lifts it; the classifier decides whether to search.
    expect(classifyWebNeed("Recommend a chair for my desk").band).toBe("borderline")
  })

  it("does NOT lift when a site-internal NO_TERM fires ('What should I watch before my shelf update?')", () => {
    // "my shelf" is a NO_TERM → noHits>0 → no-search; the lift requires noHits===0.
    expect(classifyWebNeed("What should I watch before my shelf update?").band).toBe("no-search")
  })

  it("does NOT lift 'Recommend books from my shelf' (NO_TERM my shelf suppresses)", () => {
    expect(classifyWebNeed("Recommend books from my shelf").band).toBe("no-search")
  })

  it("does NOT lift a bare 'where do i' with no expansion object (intent-family only)", () => {
    // "where do i go now" has no "from " / "start with " / "expand" object →
    // matches no EXTERNAL_INFO_FRAME → stays no-search. Guards against
    // accidentally widening to bare "where do i ".
    expect(classifyWebNeed("where do i go now").band).toBe("no-search")
  })

  it("does NOT lift an external-info frame with no substantive remainder", () => {
    // "recommend " with nothing after → remainder empty → no lift → no-search.
    expect(classifyWebNeed("recommend ").band).toBe("no-search")
  })

  it("does NOT downgrade a search-band external-info question (temporal cues still win)", () => {
    // "recommend" + "2026" (temporal +3) → score 3 → borderline, NOT search.
    // Use two temporal cues to reach search: "recommend " has no score, but
    // "what should i watch before the 2026 release" → "2026" +3, "release" +3 = +6 → search.
    expect(classifyWebNeed("what should i watch before the 2026 release").band).toBe("search")
  })
})

describe("decideWebEnabled — external-info frame routing (round 3)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("routes 'Where do I start with this post?' to the classifier which returns site-only", async () => {
    // "where do i start with " lifts to borderline; the classifier recognizes
    // "this post" as site-internal and returns site-only. Site markers are NOT
    // in NO_TERMS (adding them would break the shipped "tell me about this
    // post" → site-only test), so site-suppression for "this post" happens at
    // the classifier, not the heuristic — same path the existing test uses.
    mistralMock.mistralTurn.mockResolvedValue({ content: "site-only", tool_calls: [] })
    const r = await decideWebEnabled("Where do I start with this post?", [])
    expect(r.via).toBe("mistral-small")
    expect(r.decision).toBe("site-only")
    expect(r.webEnabled).toBe(false)
  })

  it("falls back to conservative no-search when the classifier fails on an external-info question", async () => {
    mistralMock.mistralTurn.mockRejectedValue(new Error("boom"))
    const r = await decideWebEnabled("which are the essential prerequisites for Kubernetes?", [])
    expect(r.via).toBe("mistral-small")
    expect(r.webEnabled).toBe(false)
    expect(r.decision).toBe("no-search")
  })

  it("does NOT auto-search an external-info question — the classifier decides", async () => {
    // An unparsable classifier answer must default to no-search, never search.
    mistralMock.mistralTurn.mockResolvedValue({ content: "huh?", tool_calls: [] })
    const r = await decideWebEnabled("recommend a mechanical keyboard for coding", [])
    expect(r.via).toBe("mistral-small")
    expect(r.webEnabled).toBe(false)
  })

  it("a borderline external-info frame never auto-searches — the classifier decides (advice case)", async () => {
    // "where do you go from " matches the EXTERNAL_INFO_FRAME → borderline → the
    // mistral-small classifier. The classifier may legitimately return no-search
    // for an advice follow-up ("where do you go from a breakup?"); the invariant
    // under test is that a frame match ALONE never produces search — only the
    // classifier can. Pins the advisor round-4 Q1 ruling: a frame lifts to
    // borderline, never directly to search.
    mistralMock.mistralTurn.mockResolvedValue({ content: "no-search", tool_calls: [] })
    const r = await decideWebEnabled("where do you go from a breakup?", [])
    expect(r.via).toBe("mistral-small")
    expect(r.decision).toBe("no-search")
    expect(r.webEnabled).toBe(false)
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

describe("read-post × web-trigger — web-wins routing (round 4)", () => {
  beforeEach(() => vi.clearAllMocks())

  // Pins the advisor round-4 web-wins policy. The route gate (route.ts:221-224)
  // is:
  //   let postUnderDiscussion = null
  //   if (!webTurn && !nopost && detectPostReviewIntent(message))
  //     postUnderDiscussion = await loadNewestPostForPrompt()
  // i.e. the newest-post auto-inject fires ONLY on an ordinary NON-WEB turn.
  // When the classifier selects search, webTurn=true, so the gate is false and
  // the auto-inject is SUPPRESSED; read_post remains a model-invoked fallback
  // (always in CHAT_TOOLS) for any specific/older post. The combined phrasing
  // "Recommend me a book like my new blog post" matches BOTH systems:
  //   - "recommend " is an EXTERNAL_INFO_FRAME → borderline → classifier.
  //   - "my new blog post" matches detectPostReviewIntent.
  // Note: "my blog" is a NO_TERM, but "my new blog post" does NOT contain
  // "my blog" (the word "new" sits between them), so site-internal suppression
  // does NOT fire and the turn reaches the classifier. These tests assert the
  // three constituent facts the gate composes plus a local mirror of the gate.

  it("web-wins: classifier→search suppresses the newest-post auto-inject; read_post stays a fallback", async () => {
    const msg = "Recommend me a book like my new blog post"
    // (a) reaches the classifier — borderline, not site-suppressed.
    expect(classifyWebNeed(msg).band).toBe("borderline")
    // (b) ALSO matches the post-review intent (without web-wins it would inject).
    expect(detectPostReviewIntent(msg)).toBe(true)
    // (c) the classifier can route it to search → webTurn=true.
    mistralMock.mistralTurn.mockResolvedValue({ content: "search", tool_calls: [] })
    const r = await decideWebEnabled(msg, [])
    expect(r.webEnabled).toBe(true)
    expect(r.decision).toBe("search")
    expect(r.via).toBe("mistral-small")
    // Gate mirror (route.ts:221-224): auto-inject fires only on a non-web turn.
    const webTurn = r.webEnabled
    const nopost = false
    const wouldAutoInject = !webTurn && !nopost && detectPostReviewIntent(msg)
    expect(wouldAutoInject).toBe(false)
  })

  it("post-wins: classifier→no-search keeps the auto-inject firing (the read-post path)", async () => {
    // The complement: when the classifier says no-search, webTurn=false and the
    // gate is true → the newest-post auto-inject fires. This is the path
    // read-post shipped for; web-wins only suppresses it when the classifier
    // actually routes to search.
    const msg = "Recommend me a book like my new blog post"
    expect(detectPostReviewIntent(msg)).toBe(true)
    mistralMock.mistralTurn.mockResolvedValue({ content: "no-search", tool_calls: [] })
    const r = await decideWebEnabled(msg, [])
    expect(r.webEnabled).toBe(false)
    const webTurn = r.webEnabled
    const nopost = false
    const wouldAutoInject = !webTurn && !nopost && detectPostReviewIntent(msg)
    expect(wouldAutoInject).toBe(true)
  })

  it("/nopost opts the auto-inject out independent of the web decision (the gate also checks !nopost)", async () => {
    // The third gate term: /nopost suppresses the auto-inject even on a non-web
    // turn. Pins that the opt-out is independent of the web decision.
    const msg = "Recommend me a book like my new blog post"
    expect(detectPostReviewIntent(msg)).toBe(true)
    mistralMock.mistralTurn.mockResolvedValue({ content: "no-search", tool_calls: [] })
    const r = await decideWebEnabled(msg, [])
    expect(r.webEnabled).toBe(false)
    const webTurn = r.webEnabled
    const nopost = true // the route strips /nopost and sets this flag
    const wouldAutoInject = !webTurn && !nopost && detectPostReviewIntent(msg)
    expect(wouldAutoInject).toBe(false)
  })
})