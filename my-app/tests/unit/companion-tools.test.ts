import { describe, it, expect, vi, beforeEach } from "vitest"

const chatMock = vi.hoisted(() => ({
  saveMemory: vi.fn(),
  setThreadModelPreference: vi.fn(),
  setOneTurnOverride: vi.fn(),
}))

vi.mock("@/lib/db/chat", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/chat")>("@/lib/db/chat")
  return {
    ...actual,
    saveMemory: chatMock.saveMemory,
    setThreadModelPreference: chatMock.setThreadModelPreference,
    setOneTurnOverride: chatMock.setOneTurnOverride,
  }
})

import {
  COMPANION_TOOLS,
  COMPANION_ALLOWED,
  executeProposal,
  executeCompanionToolCall,
  executeFictionReview,
  companionToolsFor,
} from "@/lib/chat/companion-tools"
import type { CompanionDraft } from "@/lib/chat/companion-tools"
import type { ToolContext } from "@/lib/chat/tools"
import type { DraftSnapshot } from "@/lib/blog/proposals"
import { draftRevision } from "@/lib/blog/proposals"

const draft: DraftSnapshot = {
  content_markdown: "The opening repeats the title. Some other line.",
  title: "Title",
  excerpt: "An excerpt.",
  meta_description: "A meta.",
}

function ctx(): ToolContext {
  return { sourceThreadId: "c1", memoryWrites: 0, maxMemoryWrites: 3 }
}

describe("COMPANION_TOOLS / COMPANION_ALLOWED", () => {
  it("advertises exactly propose_edit, save_writing_preference, set_model", () => {
    const names = COMPANION_TOOLS.map((t) => t.function.name)
    expect(names.sort()).toEqual(["propose_edit", "save_writing_preference", "set_model"])
  })
  it("the allowlist is the same set (deny-by-default)", () => {
    expect(COMPANION_ALLOWED.has("propose_edit")).toBe(true)
    expect(COMPANION_ALLOWED.has("save_writing_preference")).toBe(true)
    expect(COMPANION_ALLOWED.has("set_model")).toBe(true)
    expect(COMPANION_ALLOWED.has("read_code")).toBe(false)
    expect(COMPANION_ALLOWED.has("refresh_awareness")).toBe(false)
    expect(COMPANION_ALLOWED.has("save_memory")).toBe(false)
  })
  it("propose_edit description carries the originality constraint", () => {
    const t = COMPANION_TOOLS.find((x) => x.function.name === "propose_edit")
    expect(t?.function.description).toMatch(/explicitly requested an edit/i)
    expect(t?.function.description).toMatch(/recommend no change/i)
  })
})

describe("executeProposal — body", () => {
  it("rejects an empty original (no append)", () => {
    const r = executeProposal(
      JSON.stringify({ field: "body", original: "", replacement: "x", rationale: "r", principleId: "O4" }),
      draft
    )
    expect(r.proposal).toBeUndefined()
    expect(r.content).toMatch(/nonempty/i)
  })
  it("rejects a non-unique original and tells the model to retry", () => {
    const d: DraftSnapshot = { content_markdown: "dup dup", title: "", excerpt: "", meta_description: "" }
    const r = executeProposal(
      JSON.stringify({ field: "body", original: "dup", replacement: "x", rationale: "r", principleId: "O4" }),
      d
    )
    expect(r.proposal).toBeUndefined()
    expect(r.content).toMatch(/exactly once/)
  })
  it("accepts an exactly-once original and emits a proposal with range + baseRevision", () => {
    const r = executeProposal(
      JSON.stringify({
        field: "body",
        original: "The opening repeats the title.",
        replacement: "The opening restates the premise.",
        rationale: "Diagnosis: repeats. Basis: SW1.",
        principleId: "SW1",
      }),
      draft
    )
    expect(r.proposal).toBeDefined()
    expect(r.proposal?.field).toBe("body")
    expect(r.proposal?.original).toBe("The opening repeats the title.")
    expect(r.proposal?.range?.start).toBe(0)
    expect(r.proposal?.range?.end).toBe("The opening repeats the title.".length)
    expect(r.proposal?.baseRevision).toBe(draftRevision(draft))
    expect(r.memoryWrite).toBe(false)
  })
  it("rejects an oversized original/replacement/rationale", () => {
    const r1 = executeProposal(
      JSON.stringify({ field: "body", original: "x".repeat(501), replacement: "y", rationale: "r", principleId: "O4" }),
      draft
    )
    expect(r1.proposal).toBeUndefined()
    const r2 = executeProposal(
      JSON.stringify({ field: "body", original: "The opening repeats the title.", replacement: "y".repeat(2001), rationale: "r", principleId: "O4" }),
      draft
    )
    expect(r2.proposal).toBeUndefined()
    const r3 = executeProposal(
      JSON.stringify({ field: "body", original: "The opening repeats the title.", replacement: "y", rationale: "r".repeat(301), principleId: "O4" }),
      draft
    )
    expect(r3.proposal).toBeUndefined()
  })
  it("handles malformed JSON args gracefully", () => {
    const r = executeProposal("{not json", draft)
    expect(r.proposal).toBeUndefined()
    expect(r.content).toMatch(/Tool error/i)
  })
})

describe("executeProposal — scalars", () => {
  it("records originalValue for a title edit", () => {
    const r = executeProposal(
      JSON.stringify({ field: "title", replacement: "New Title", rationale: "r", principleId: "SW1" }),
      draft
    )
    expect(r.proposal?.field).toBe("title")
    expect(r.proposal?.originalValue).toBe("Title")
    expect(r.proposal?.baseRevision).toBe(draftRevision(draft))
  })
  it("rejects an unknown field", () => {
    const r = executeProposal(
      JSON.stringify({ field: "slug", replacement: "x", rationale: "r", principleId: "O4" }),
      draft
    )
    expect(r.proposal).toBeUndefined()
    expect(r.content).toMatch(/invalid field/)
  })
})

describe("executeCompanionToolCall — dispatch allowlist (security boundary)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("refuses read_code (unadvertised) even though executeToolCall knows it", async () => {
    const r = await executeCompanionToolCall("read_code", JSON.stringify({ feature: "blog" }), ctx(), draft)
    expect(r.memoryWrite).toBe(false)
    expect(r.content).toMatch(/Tool unavailable in writing companion/)
  })
  it("refuses refresh_awareness", async () => {
    const r = await executeCompanionToolCall("refresh_awareness", "{}", ctx(), draft)
    expect(r.content).toMatch(/Tool unavailable/)
  })
  it("refuses an arbitrary/unknown tool name", async () => {
    const r = await executeCompanionToolCall("publish_post", "{}", ctx(), draft)
    expect(r.content).toMatch(/Tool unavailable/)
  })
  it("routes propose_edit to executeProposal", async () => {
    const r = await executeCompanionToolCall(
      "propose_edit",
      JSON.stringify({ field: "title", replacement: "New Title", rationale: "r", principleId: "SW1" }),
      ctx(),
      draft
    )
    expect(r.proposal?.field).toBe("title")
  })
  it("set_model delegates to the reviewed executeToolCall (persistent)", async () => {
    chatMock.setThreadModelPreference.mockResolvedValue(undefined)
    const r = await executeCompanionToolCall(
      "set_model",
      JSON.stringify({ tier: "large", scope: "persistent" }),
      ctx(),
      draft
    )
    expect(chatMock.setThreadModelPreference).toHaveBeenCalledWith("c1", "large")
    expect(r.content).toMatch(/large/)
  })
})

describe("executeCompanionToolCall — save_writing_preference", () => {
  beforeEach(() => vi.clearAllMocks())

  it("saves a writing- prefixed preference and counts the cap", async () => {
    chatMock.saveMemory.mockResolvedValue({
      id: "m1",
      type: "feedback",
      name: "writing-keep-em-dashes",
      description: "d",
      content: "Never remove em-dashes.",
      links: [],
      source_thread_id: "c1",
      source: "chat",
      fingerprint: null,
      last_used_at: "x",
      last_synced_at: null,
      created_at: "x",
      updated_at: "x",
      active: true,
    })
    const c = ctx()
    const r = await executeCompanionToolCall(
      "save_writing_preference",
      JSON.stringify({ name: "writing-keep-em-dashes", description: "d", content: "Never remove em-dashes." }),
      c,
      draft
    )
    expect(r.memoryWrite).toBe(true)
    expect(c.memoryWrites).toBe(1)
    expect(chatMock.saveMemory).toHaveBeenCalledWith(
      expect.objectContaining({ type: "feedback", name: "writing-keep-em-dashes", sourceThreadId: "c1", source: "chat" })
    )
  })
  it("rejects a name without the writing- prefix", async () => {
    const r = await executeCompanionToolCall(
      "save_writing_preference",
      JSON.stringify({ name: "keep-em-dashes", description: "d", content: "c" }),
      ctx(),
      draft
    )
    expect(r.memoryWrite).toBe(false)
    expect(r.content).toMatch(/Tool error/i)
    expect(chatMock.saveMemory).not.toHaveBeenCalled()
  })
  it("refuses once the shared cap is reached", async () => {
    const c = ctx()
    c.memoryWrites = c.maxMemoryWrites
    const r = await executeCompanionToolCall(
      "save_writing_preference",
      JSON.stringify({ name: "writing-x", description: "d", content: "c" }),
      c,
      draft
    )
    expect(r.memoryWrite).toBe(false)
    expect(r.content).toMatch(/cap/)
    expect(chatMock.saveMemory).not.toHaveBeenCalled()
  })
})
// submit_fiction_review — the structured terminal for fiction mode. The model
// submits the WHOLE review (assessment + noChange + findings[]) as ONE call;
// each finding optionally carries a surgical body edit. Pure (no DB, no import)
// — validates each edit with the same rules as executeProposal (anchor-occurs-
// once, rationale 1–300, replacement 1–2000, original ≤500). Emits one proposal
// per valid finding-with-edit + a fictionReview payload. The prose-edit loophole
// is structurally closed: there is no prose assessment slot (assessment lives
// inside the tool call) and fiction mode does not offer propose_edit.
const fDraft: CompanionDraft = {
  title: "t",
  excerpt: "",
  meta_description: "",
  content_markdown: "The bar is dim, and it remained that way for years.",
}

describe("companionToolsFor — fiction terminal selection", () => {
  it("fiction mode → submit_fiction_review, NO propose_edit", () => {
    const names = companionToolsFor("fiction").map((t) => t.function.name)
    expect(names).toContain("submit_fiction_review")
    expect(names).not.toContain("propose_edit")
    expect(names).toContain("save_writing_preference")
    expect(names).toContain("set_model")
  })
  it("non-fiction mode → propose_edit, NO submit_fiction_review", () => {
    const names = companionToolsFor("prose").map((t) => t.function.name)
    expect(names).toContain("propose_edit")
    expect(names).not.toContain("submit_fiction_review")
  })
  it("undefined mode → blog tools (propose_edit, no submit_fiction_review)", () => {
    const names = companionToolsFor(undefined).map((t) => t.function.name)
    expect(names).toContain("propose_edit")
    expect(names).not.toContain("submit_fiction_review")
  })
  it("submit_fiction_review is in the allowlist", () => {
    expect(COMPANION_ALLOWED.has("submit_fiction_review")).toBe(true)
  })
})

describe("executeFictionReview", () => {
  it("emits a proposal per finding-with-edit + the review payload", () => {
    const r = executeFictionReview(
      JSON.stringify({
        assessment: "Opening tense inconsistency; one surgical fix.",
        noChange: false,
        findings: [
          {
            diagnosis: "Tense shift: 'is' then 'remained'.",
            principleId: "Z2",
            original: "The bar is dim, and it remained",
            replacement: "The bar was dim, and it had remained",
            rationale: "Unity of tense; both clauses past.",
          },
        ],
      }),
      fDraft
    )
    expect(r.proposals?.length).toBe(1)
    expect(r.proposals?.[0].field).toBe("body")
    expect(r.proposals?.[0].original).toBe("The bar is dim, and it remained")
    expect(r.proposals?.[0].replacement).toBe("The bar was dim, and it had remained")
    expect(r.proposals?.[0].principleId).toBe("Z2")
    expect(r.fictionReview?.assessment).toBe("Opening tense inconsistency; one surgical fix.")
    expect(r.fictionReview?.noChange).toBe(false)
    expect(r.fictionReview?.findings.length).toBe(1)
    expect(r.fictionReview?.findings[0].hasEdit).toBe(true)
    expect(r.memoryWrite).toBe(false)
    expect(r.content).toMatch(/1 finding/i)
  })

  it("noChange:true with empty findings → NO CHANGE, 0 proposals", () => {
    const r = executeFictionReview(
      JSON.stringify({ assessment: "Clean.", noChange: true, findings: [] }),
      fDraft
    )
    expect(r.proposals?.length ?? 0).toBe(0)
    expect(r.fictionReview?.noChange).toBe(true)
    expect(r.fictionReview?.findings.length).toBe(0)
    expect(r.content).toMatch(/NO CHANGE/i)
  })

  it("noChange:true with non-empty findings → rejected (tool error, no payload)", () => {
    const r = executeFictionReview(
      JSON.stringify({
        assessment: "x",
        noChange: true,
        findings: [{ diagnosis: "d", principleId: "Z1" }],
      }),
      fDraft
    )
    expect(r.fictionReview).toBeUndefined()
    expect(r.proposals).toBeUndefined()
    expect(r.content).toMatch(/noChange/i)
  })

  it("bad anchor (0 occurrences) → that finding's edit skipped, others proceed", () => {
    const r = executeFictionReview(
      JSON.stringify({
        assessment: "a",
        noChange: false,
        findings: [
          { diagnosis: "bad", principleId: "Z1", original: "NOPE NOT IN DRAFT", replacement: "x", rationale: "y" },
          { diagnosis: "good", principleId: "Z2", original: "The bar is dim, and it remained", replacement: "The bar was dim", rationale: "unity of tense here" },
        ],
      }),
      fDraft
    )
    expect(r.proposals?.length).toBe(1)
    expect(r.proposals?.[0].principleId).toBe("Z2")
    expect(r.fictionReview?.findings.length).toBe(2)
    expect(r.fictionReview?.findings[0].hasEdit).toBe(false)
    expect(r.fictionReview?.findings[1].hasEdit).toBe(true)
  })

  it("diagnosis-only finding (no edit) → no proposal, hasEdit false", () => {
    const r = executeFictionReview(
      JSON.stringify({
        assessment: "a",
        noChange: false,
        findings: [{ diagnosis: "an observation", principleId: "V1" }],
      }),
      fDraft
    )
    expect(r.proposals?.length ?? 0).toBe(0)
    expect(r.fictionReview?.findings[0].hasEdit).toBe(false)
  })

  it("multi-finding review emits N proposals for N valid edits", () => {
    const r = executeFictionReview(
      JSON.stringify({
        assessment: "two fixes",
        noChange: false,
        findings: [
          { diagnosis: "a", principleId: "Z1", original: "The bar is dim, and it remained", replacement: "The bar was dim, and it had remained", rationale: "tense unity one" },
          { diagnosis: "b", principleId: "Z2", original: "that way for years", replacement: "that way for many years", rationale: "tense unity two" },
        ],
      }),
      fDraft
    )
    expect(r.proposals?.length).toBe(2)
    expect(r.content).toMatch(/2 finding/i)
  })
})
