import { describe, it, expect } from "vitest"
import { buildSystemPrompt } from "@/lib/chat/prompt"
import type { MemoryRow } from "@/lib/db/chat"

const baseRow = (over: Partial<MemoryRow> = {}): MemoryRow => ({
  id: "r1",
  type: "user",
  name: "prefers-terracotta",
  description: "likes warm terracotta accents",
  content: "Prefers terracotta accents.",
  links: [],
  source_thread_id: null,
  source: "chat",
  fingerprint: null,
  last_used_at: "2026-07-11T00:00:00Z",
  last_synced_at: null,
  created_at: "2026-07-11T00:00:00Z",
  updated_at: "2026-07-11T00:00:00Z",
  active: true,
  ...over,
})

describe("buildSystemPrompt", () => {
  it("embeds the live site context", () => {
    const prompt = buildSystemPrompt({ siteContext: "# SITE CONTEXT\nTool wheel here", memories: [] })
    expect(prompt).toContain("# SITE CONTEXT")
    expect(prompt).toContain("Tool wheel here")
  })

  it("states the hard scope: the bot can only write memories, never the site", () => {
    const prompt = buildSystemPrompt({ siteContext: "ctx", memories: [] })
    expect(prompt).toMatch(/can ONLY write to your own memory bank/i)
    expect(prompt).toMatch(/cannot edit the site/i)
    // Eight tools are enumerated.
    expect(prompt).toContain("save_memory")
    expect(prompt).toContain("refresh_awareness")
    expect(prompt).toContain("read_code")
    expect(prompt).toContain("read_post")
    expect(prompt).toContain("set_model")
    expect(prompt).toContain("web_search")
    expect(prompt).toMatch(/eight tools/)
    // set_model is explicitly scoped away from site edits.
    expect(prompt).toMatch(/set_model tool only changes which Mistral model/)
  })

  it("separates site awareness from personal memories and renders links", () => {
    const prompt = buildSystemPrompt({
      siteContext: "ctx",
      memories: [
        baseRow({ type: "site", name: "site:blog", content: "# Blog index" }),
        baseRow({
          type: "feedback",
          name: "be-concise",
          description: "keep it tight",
          content: "Be concise.",
          links: ["prefers-terracotta"],
        }),
      ],
    })
    expect(prompt).toContain("Site awareness")
    expect(prompt).toContain("Personal memories")
    expect(prompt).toContain("[feedback] be-concise")
    expect(prompt).toContain("[[prefers-terracotta]]")
  })

  it("shows a placeholder when there are no memories yet", () => {
    const prompt = buildSystemPrompt({ siteContext: "ctx", memories: [] })
    expect(prompt).toMatch(/No memories yet/)
  })
})

describe("buildSystemPrompt — honest site view (no 'intimately' oversell)", () => {
  it("does not claim to know the site intimately", () => {
    const prompt = buildSystemPrompt({ siteContext: "ctx", memories: [] })
    expect(prompt).not.toMatch(/knows this site intimately/i)
  })
  it("states the live read-only index + the read_post tool", () => {
    const prompt = buildSystemPrompt({ siteContext: "ctx", memories: [] })
    expect(prompt).toMatch(/live, read-only view/i)
    expect(prompt).toMatch(/read_post/i)
  })
  it("steers the model to read a post before commenting on it", () => {
    const prompt = buildSystemPrompt({ siteContext: "ctx", memories: [] })
    expect(prompt).toMatch(/before summarizing, quoting, critiquing/i)
    expect(prompt).toMatch(/never describe or quote a post you haven't read/i)
  })
})

describe("buildSystemPrompt — postUnderDiscussion section", () => {
  it("injects the post body under a labelled section when provided", () => {
    const prompt = buildSystemPrompt({
      siteContext: "ctx",
      memories: [],
      postUnderDiscussion: "**GEI**\nSlug: gei\n\nBody text here.",
    })
    expect(prompt).toMatch(/Post under discussion/i)
    expect(prompt).toContain("Body text here.")
    expect(prompt).toMatch(/if this isn't the one you meant/i)
  })
  it("omits the section when postUnderDiscussion is null/undefined/blank", () => {
    expect(buildSystemPrompt({ siteContext: "ctx", memories: [] })).not.toMatch(/Post under discussion/i)
    expect(
      buildSystemPrompt({ siteContext: "ctx", memories: [], postUnderDiscussion: null })
    ).not.toMatch(/Post under discussion/i)
    expect(
      buildSystemPrompt({ siteContext: "ctx", memories: [], postUnderDiscussion: "   " })
    ).not.toMatch(/Post under discussion/i)
  })
})