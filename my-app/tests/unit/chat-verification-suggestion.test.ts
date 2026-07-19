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
vi.mock("@/lib/db/posts", () => ({
  getPosts: vi.fn(),
  getPublishedPostBySlug: vi.fn(),
}))

import {
  detectExternalVerificationNeed,
} from "@/lib/chat/web-trigger"
import type { ChatMessageRow } from "@/lib/db/chat"

// A provenance row: an assistant turn whose web_research audit recorded a
// subjectMatch:true run with a non-null subject (the B.3 recent web-verified
// external subject). Read-only audit data — never memory.
function provenanceRow(subject: string): ChatMessageRow {
  return {
    id: "a1",
    thread_id: "t1",
    role: "assistant",
    content: "establishment answer",
    tool_calls: null,
    model: "mistral-large-latest",
    reasoning: null,
    telemetry: null,
    web_research: {
      schemaVersion: 1,
      availableToAssistantMessage: true,
      runs: [
        {
          via: "pipeline",
          mode: "auto",
          queries: ["the odyssey christopher nolan"],
          subject,
          subjectMatch: true,
          guard: "none",
          sources: [],
          pages: [],
          evidenceInjected: "…",
          evidenceChars: 100,
          effort: "low",
          maxTokens: 8,
          searchedAt: "2026-07-19T00:00:00Z",
        },
      ],
    },
    created_at: "2026-07-19T00:00:00Z",
  }
}

describe("detectExternalVerificationNeed — positive boundary (suggests)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("Spider-Man colon-title prereq → external-prerequisites", () => {
    const r = detectExternalVerificationNeed(
      "What are the pre-requisites for Spider-Man: Brand New Day?",
      []
    )
    expect(r.suggested).toBe(true)
    expect(r.reason).toBe("external-prerequisites")
    expect(r.subject).toBe("Spider-Man: Brand New Day")
  })

  it("Kubernetes prereq → external-prerequisites (software-domain cue)", () => {
    const r = detectExternalVerificationNeed(
      "which are the essential prerequisites for Kubernetes?",
      []
    )
    expect(r.suggested).toBe(true)
    expect(r.reason).toBe("external-prerequisites")
    expect(r.subject).toBe("Kubernetes")
  })

  it("'where should I start with Kubernetes' → external-prerequisites", () => {
    const r = detectExternalVerificationNeed(
      "where should I start with Kubernetes",
      []
    )
    expect(r.suggested).toBe(true)
    expect(r.reason).toBe("external-prerequisites")
    expect(r.subject).toBe("Kubernetes")
  })

  it("must-watch-before a titled work → external-prerequisites", () => {
    const r = detectExternalVerificationNeed(
      "what must I watch before Spider-Man: Brand New Day?",
      []
    )
    expect(r.suggested).toBe(true)
    expect(r.reason).toBe("external-prerequisites")
  })

  it("currentness on a named work → current-public-facts with subject", () => {
    const r = detectExternalVerificationNeed(
      "what are the latest reviews of The Odyssey?",
      []
    )
    expect(r.suggested).toBe(true)
    expect(r.reason).toBe("current-public-facts")
    expect(r.subject).toBe("The Odyssey")
  })

  it("currentness anaphoric (no extractable subject) → current-public-facts, subject null", () => {
    const r = detectExternalVerificationNeed(
      "how are the reviews putting it in the canon?",
      []
    )
    expect(r.suggested).toBe(true)
    expect(r.reason).toBe("current-public-facts")
    expect(r.subject).toBeNull()
  })

  it("attribution 'did Dan Koe say…' → attribution-or-quote", () => {
    const r = detectExternalVerificationNeed(
      "did Dan Koe say that AI will replace most creators?",
      []
    )
    expect(r.suggested).toBe(true)
    expect(r.reason).toBe("attribution-or-quote")
  })

  it("attribution 'who said…' → attribution-or-quote", () => {
    const r = detectExternalVerificationNeed("who said familiarity breeds contempt?", [])
    expect(r.suggested).toBe(true)
    expect(r.reason).toBe("attribution-or-quote")
  })

  it("provenance + short factual follow-up → recent-subject-follow-up (subject from audit)", () => {
    const r = detectExternalVerificationNeed(
      "how are the reviews putting it in the canon?",
      [provenanceRow("The Odyssey")]
    )
    expect(r.suggested).toBe(true)
    expect(r.reason).toBe("recent-subject-follow-up")
    expect(r.subject).toBe("The Odyssey")
  })

  it("provenance precedes the prereq pattern for an anaphoric object ('prerequisites for it')", () => {
    // "it" fails the cue, so without provenance this would not suggest. With
    // provenance the recent-subject-follow-up branch fires first.
    const r = detectExternalVerificationNeed(
      "what are the prerequisites for it?",
      [provenanceRow("The Odyssey")]
    )
    expect(r.suggested).toBe(true)
    expect(r.reason).toBe("recent-subject-follow-up")
    expect(r.subject).toBe("The Odyssey")
  })
})

describe("detectExternalVerificationNeed — negative boundary (no suggestion)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("NOTERM site suppression: 'prerequisites for my blog post' → no suggestion", () => {
    expect(detectExternalVerificationNeed("What are the prerequisites for my blog post?", []).suggested).toBe(false)
  })
  it("NOTERM: 'prerequisites for my shelf update' → no suggestion", () => {
    expect(detectExternalVerificationNeed("What are the prerequisites for my shelf update?", []).suggested).toBe(false)
  })
  it("cue fails on advice: 'prerequisites for a good desk chair' → no suggestion", () => {
    expect(detectExternalVerificationNeed("What are the prerequisites for a good desk chair?", []).suggested).toBe(false)
  })
  it("cue fails on activity: 'prerequisites for joining the book club' → no suggestion", () => {
    expect(detectExternalVerificationNeed("What are the prerequisites for joining the book club?", []).suggested).toBe(false)
  })
  it("cue fails on bare-word media title: 'prerequisites for Inception?' → no suggestion (acceptable v1 gap)", () => {
    // No colon, not on the software list → cue fails. Under the suggestion
    // model a missed external object is a missing suggestion (user can /web),
    // NOT a wrong answer. Documented v1 positive-boundary gap.
    expect(detectExternalVerificationNeed("Prerequisites for Inception?", []).suggested).toBe(false)
  })
  it("'this post' (not a NOTERM) + cue fails → no suggestion", () => {
    expect(detectExternalVerificationNeed("Which prerequisites for this post should I add?", []).suggested).toBe(false)
  })
  it("incomplete object 'Prerequisites for…' → no suggestion (substantive-object guard)", () => {
    expect(detectExternalVerificationNeed("Prerequisites for…", []).suggested).toBe(false)
  })
  it("'Recommend a chair for my desk' → no suggestion (recommend is not a suggestion signal)", () => {
    expect(detectExternalVerificationNeed("Recommend a chair for my desk", []).suggested).toBe(false)
  })
  it("'Where do you go from a breakup?' → no suggestion", () => {
    expect(detectExternalVerificationNeed("where do you go from a breakup?", []).suggested).toBe(false)
  })
  it("'Recommend me a book like my new blog post' → no suggestion", () => {
    // "my new blog post" does NOT contain the NO_TERM "my blog" (the word
    // "new" sits between), so NOTERM doesn't fire — but "recommend" is not a
    // suggestion signal and no currentness/attribution pattern fires, so no
    // suggestion. Retains post-first behavior.
    expect(detectExternalVerificationNeed("Recommend me a book like my new blog post", []).suggested).toBe(false)
  })
  it("currentness suppressed by NOTERM: 'latest reviews of my blog' → no suggestion", () => {
    expect(detectExternalVerificationNeed("what are the latest reviews of my blog?", []).suggested).toBe(false)
  })
  it("greeting → no suggestion", () => {
    expect(detectExternalVerificationNeed("hi there!", []).suggested).toBe(false)
  })
})

describe("detectExternalVerificationNeed — purity (no model call, v1)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("never calls mistralTurn (v1 detector is lexical/heuristic + provenance only)", () => {
    detectExternalVerificationNeed("which are the prerequisites for Kubernetes?", [])
    detectExternalVerificationNeed("did Dan Koe say that?", [])
    detectExternalVerificationNeed("latest reviews of The Odyssey?", [provenanceRow("The Odyssey")])
    expect(mistralMock.mistralTurn).not.toHaveBeenCalled()
  })
})