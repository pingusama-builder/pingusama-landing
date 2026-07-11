import { describe, it, expect, vi, beforeEach } from "vitest"

// ── buildWritingContext ──────────────────────────────────────────────────
const chatMock = vi.hoisted(() => ({ recallMemories: vi.fn() }))
const postsMock = vi.hoisted(() => ({ getPosts: vi.fn() }))

vi.mock("@/lib/db/chat", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/chat")>("@/lib/db/chat")
  return { ...actual, recallMemories: chatMock.recallMemories }
})
vi.mock("@/lib/db/posts", () => ({ getPosts: postsMock.getPosts }))

import { buildWritingContext } from "@/lib/chat/writing-context"

describe("buildWritingContext", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns writing prefs + feedback, recent post titles/excerpts, voice, and markdown conventions", async () => {
    chatMock.recallMemories.mockResolvedValue([
      {
        id: "m1",
        type: "feedback",
        name: "writing-prefers-fragment-sentences",
        description: "likes short bursts",
        content: "Keep sentences short and rhythmic.",
        links: [],
        source_thread_id: null,
        source: "chat",
        fingerprint: null,
        last_used_at: "x",
        last_synced_at: null,
        created_at: "x",
        updated_at: "x",
        active: true,
      },
    ])
    postsMock.getPosts.mockResolvedValue([
      {
        id: "p1",
        slug: "a-post",
        title: "A Quiet Build",
        excerpt: "Notes on patience.",
        content_markdown: "",
        content_html: "",
        category: null,
        tags: null,
        status: "published",
        published_at: "2026-07-01",
        updated_at: "x",
        created_at: "x",
        author_id: null,
        cover_image_url: null,
        meta_description: null,
      },
    ])

    const ctx = await buildWritingContext()
    expect(ctx).toContain("WRITING CONTEXT")
    expect(ctx).toContain("writing-prefers-fragment-sentences")
    expect(ctx).toContain("Keep sentences short and rhythmic.")
    expect(ctx).toContain("A Quiet Build")
    expect(ctx).toContain("Notes on patience.")
    expect(ctx).toMatch(/warm.*plain.*handcrafted/i)
    expect(ctx).toContain("Markdown conventions")
    expect(ctx).toContain("# H1")
  })

  it("reads published posts only and a bounded number", async () => {
    chatMock.recallMemories.mockResolvedValue([])
    postsMock.getPosts.mockResolvedValue([])
    await buildWritingContext()
    expect(postsMock.getPosts).toHaveBeenCalledWith(expect.objectContaining({ status: "published", limit: 8 }))
  })

  it("excludes site awareness from recall", async () => {
    chatMock.recallMemories.mockResolvedValue([])
    postsMock.getPosts.mockResolvedValue([])
    await buildWritingContext()
    expect(chatMock.recallMemories).toHaveBeenCalledWith(
      expect.objectContaining({ includeSite: false })
    )
  })
})