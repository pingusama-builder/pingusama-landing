import { describe, it, expect, vi, beforeEach } from "vitest"

const postsMock = vi.hoisted(() => ({
  getPosts: vi.fn(),
  getPublishedPostBySlug: vi.fn(),
}))
vi.mock("@/lib/db/posts", () => ({
  getPosts: postsMock.getPosts,
  getPublishedPostBySlug: postsMock.getPublishedPostBySlug,
}))

import {
  detectPostReviewIntent,
  formatPostForPrompt,
  readPostForTool,
  loadNewestPostForPrompt,
  POST_BODY_MAX_CHARS,
} from "@/lib/chat/post-read"
import type { Post } from "@/lib/db/posts"

function makePost(over: Partial<Post> = {}): Post {
  return {
    id: "p1",
    slug: "introducing-the-gaming-experience-index-gei",
    title: "Introducing the Gaming Experience Index (GEI)",
    excerpt: "A new lens for games.",
    content_markdown: "## Why\nGames deserve a better index.\n\nBody text here.",
    content_html: "<p>Body text here.</p>",
    category: "gaming",
    tags: ["games", "index"],
    status: "published",
    published_at: "2026-07-18T00:00:00Z",
    updated_at: "2026-07-18T00:00:00Z",
    created_at: "2026-07-18T00:00:00Z",
    author_id: null,
    cover_image_url: null,
    meta_description: null,
    ...over,
  }
}

describe("detectPostReviewIntent", () => {
  it("matches 'my new blog post'", () => {
    expect(detectPostReviewIntent("what do you like or not like about my new blog post")).toBe(true)
  })
  it("matches 'the new post', 'a new post', 'new blog post', newest/latest/most-recent", () => {
    expect(detectPostReviewIntent("review the new post please")).toBe(true)
    expect(detectPostReviewIntent("I wrote a new post, thoughts?")).toBe(true)
    expect(detectPostReviewIntent("feedback on my new blog post")).toBe(true)
    expect(detectPostReviewIntent("review my newest post")).toBe(true)
    expect(detectPostReviewIntent("thoughts on my latest blog post")).toBe(true)
    expect(detectPostReviewIntent("the most recent post")).toBe(true)
  })
  it("does NOT match a bare 'my post' (no new/newest/latest) — tool handles that, not auto-inject", () => {
    expect(detectPostReviewIntent("what do you think of my post")).toBe(false)
  })
  it("does NOT match unrelated uses of 'post'", () => {
    expect(detectPostReviewIntent("how do I post a comment")).toBe(false)
    expect(detectPostReviewIntent("post office hours")).toBe(false)
    expect(detectPostReviewIntent("what's new with you")).toBe(false)
    expect(detectPostReviewIntent("newest articles on the blog")).toBe(false)
  })
})

describe("formatPostForPrompt", () => {
  it("renders title, category, date, tags, slug, then the markdown body", () => {
    const out = formatPostForPrompt(makePost())
    expect(out).toContain("**Introducing the Gaming Experience Index (GEI)**")
    expect(out).toContain("— gaming")
    expect(out).toContain("· 2026-07-18")
    expect(out).toContain("[games, index]")
    expect(out).toContain("Slug: introducing-the-gaming-experience-index-gei")
    expect(out).toContain("## Why")
    expect(out).toContain("Body text here.")
  })
  it("omits category/tags/date when absent", () => {
    const out = formatPostForPrompt(
      makePost({ category: null, tags: null, published_at: null })
    )
    expect(out).not.toContain("— gaming")
    expect(out).not.toMatch(/\[.*\]/)
    expect(out).not.toContain("· 2026")
  })
  it("truncates an over-cap body with a marker, keeps the head", () => {
    const big = "x".repeat(POST_BODY_MAX_CHARS + 500)
    const out = formatPostForPrompt(makePost({ content_markdown: big }))
    expect(out.length).toBeLessThan(big.length + 200)
    expect(out).toContain("[truncated]")
    expect(out.endsWith("x".repeat(10) + "\n\n…[truncated]") || out.includes("[truncated]")).toBe(true)
  })
  it("handles a null/empty body without throwing", () => {
    const out = formatPostForPrompt(makePost({ content_markdown: "" }))
    expect(out).toContain("Slug: ")
    expect(out).not.toThrow
  })
})

describe("readPostForTool", () => {
  beforeEach(() => vi.clearAllMocks())
  it("returns the newest published post when slug is omitted", async () => {
    postsMock.getPosts.mockResolvedValue([makePost()])
    const out = await readPostForTool({})
    expect(postsMock.getPosts).toHaveBeenCalledWith({ status: "published", limit: 1 })
    expect(out).toContain("Introducing the Gaming Experience Index (GEI)")
    expect(out).toContain("Body text here.")
  })
  it("returns a specific post by slug", async () => {
    postsMock.getPublishedPostBySlug.mockResolvedValue(makePost({ slug: "matt-haig", title: "Dear Matt Haig" }))
    const out = await readPostForTool({ slug: "matt-haig" })
    expect(postsMock.getPublishedPostBySlug).toHaveBeenCalledWith("matt-haig")
    expect(out).toContain("Dear Matt Haig")
    expect(postsMock.getPosts).not.toHaveBeenCalled()
  })
  it("reports a clear miss for an unknown slug (no throw)", async () => {
    postsMock.getPublishedPostBySlug.mockResolvedValue(null)
    const out = await readPostForTool({ slug: "nope" })
    expect(out).toMatch(/No published post found for slug "nope"/)
  })
  it("reports when there are no published posts", async () => {
    postsMock.getPosts.mockResolvedValue([])
    const out = await readPostForTool({})
    expect(out).toMatch(/No published posts yet/)
  })
  it("trims whitespace slug and treats blank slug as 'newest'", async () => {
    postsMock.getPosts.mockResolvedValue([makePost()])
    const out = await readPostForTool({ slug: "   " })
    expect(postsMock.getPosts).toHaveBeenCalledWith({ status: "published", limit: 1 })
    expect(out).toContain("Introducing the Gaming Experience Index (GEI)")
  })
})

describe("loadNewestPostForPrompt", () => {
  beforeEach(() => vi.clearAllMocks())
  it("returns the formatted newest post", async () => {
    postsMock.getPosts.mockResolvedValue([makePost()])
    const out = await loadNewestPostForPrompt()
    expect(out).not.toBeNull()
    expect(out).toContain("Body text here.")
  })
  it("returns null when there are no published posts", async () => {
    postsMock.getPosts.mockResolvedValue([])
    expect(await loadNewestPostForPrompt()).toBeNull()
  })
  it("returns null (fail-closed) when the fetch throws", async () => {
    postsMock.getPosts.mockRejectedValue(new Error("supabase down"))
    expect(await loadNewestPostForPrompt()).toBeNull()
  })
})