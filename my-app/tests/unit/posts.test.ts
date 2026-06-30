import { describe, it, expect, beforeAll, afterAll } from "vitest"
import dotenv from "dotenv"
import ws from "ws"
import {
  parseAndPreparePost,
  createPost,
  getPostBySlug,
  getPostById,
  getPosts,
  updatePost,
  deletePost,
  searchPosts,
  getPublishedPostBySlug,
  Post,
} from "@/lib/db/posts"

if (typeof globalThis.WebSocket === "undefined") {
  // Polyfill WebSocket for Node.js < 22 so Supabase realtime initializes in tests.
  // @ts-expect-error ws constructor is compatible with the global WebSocket type.
  globalThis.WebSocket = ws
}

dotenv.config({ path: ".env.local" })

const enabled = Boolean(
  process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL,
)
const describeIfEnabled = enabled ? describe : describe.skip

describe("parseAndPreparePost", () => {
  it("parses frontmatter and body into prepared post fields", async () => {
    const source = `---
title: Test Post
category: tutorial
tags:
  - a
  - b
status: published
published_at: 2024-01-15T08:00:00.000Z
cover_image_url: https://example.com/cover.png
meta_description: A meta description
---

# Hello

This is the **body**.
`

    const result = await parseAndPreparePost(source)

    expect(result.title).toBe("Test Post")
    expect(result.category).toBe("tutorial")
    expect(result.tags).toEqual(["a", "b"])
    expect(result.status).toBe("published")
    expect(result.published_at).toBe("2024-01-15T08:00:00.000Z")
    expect(result.cover_image_url).toBe("https://example.com/cover.png")
    expect(result.meta_description).toBe("A meta description")
    expect(result.content_markdown).toBe(source)
    expect(result.content_html).toContain("<h1>Hello</h1>")
    expect(result.content_html).toContain("<strong>body</strong>")
    expect(result.excerpt).toContain("This is the body")
  })

  it("uses overrides when provided", async () => {
    const source = `---
title: Frontmatter Title
---

Body text.
`

    const result = await parseAndPreparePost(source, {
      title: "Override Title",
      status: "archived",
      category: "override-category",
    })

    expect(result.title).toBe("Override Title")
    expect(result.status).toBe("archived")
    expect(result.category).toBe("override-category")
  })

  it("falls back to defaults when frontmatter and overrides are missing", async () => {
    const source = `# Title

Body here.`

    const result = await parseAndPreparePost(source)

    expect(result.title).toBe("Untitled")
    expect(result.status).toBe("draft")
    expect(result.category).toBeNull()
    expect(result.tags).toBeNull()
    expect(result.published_at).toBeNull()
    expect(result.cover_image_url).toBeNull()
    expect(result.meta_description).toBeNull()
    expect(result.author_id).toBeNull()
  })
})

describeIfEnabled("posts CRUD (live Supabase)", () => {
  const slug = `test-${Date.now()}-${Math.floor(Math.random() * 100000)}`
  let post: Post

  beforeAll(async () => {
    const prepared = await parseAndPreparePost(
      `---
title: Integration Test Post
excerpt: A short excerpt
category: testing
tags:
  - vitest
  - integration
---

# Integration Test

This post is created during automated testing.
`,
    )

    post = await createPost({
      ...prepared,
      slug,
    })
  })

  afterAll(async () => {
    if (post?.id) {
      await deletePost(post.id)
    }
  })

  it("creates a post with required fields", () => {
    expect(post.id).toBeDefined()
    expect(post.slug).toBe(slug)
    expect(post.title).toBe("Integration Test Post")
    expect(post.status).toBe("draft")
    expect(post.category).toBe("testing")
    expect(post.tags).toEqual(["vitest", "integration"])
    expect(post.content_html).toContain("<h1>Integration Test</h1>")
  })

  it("reads the post by slug", async () => {
    const found = await getPostBySlug(slug)
    expect(found).not.toBeNull()
    expect(found?.id).toBe(post.id)
    expect(found?.title).toBe(post.title)
  })

  it("reads the post by id", async () => {
    const found = await getPostById(post.id)
    expect(found).not.toBeNull()
    expect(found?.slug).toBe(slug)
  })

  it("lists posts with status filter", async () => {
    const drafts = await getPosts({ status: "draft", limit: 10 })
    expect(drafts.some((p) => p.id === post.id)).toBe(true)
  })

  it("lists posts with tag filter", async () => {
    const tagged = await getPosts({ tag: "vitest", limit: 10 })
    expect(tagged.some((p) => p.id === post.id)).toBe(true)
  })

  it("updates the post", async () => {
    const updated = await updatePost(post.id, {
      title: "Updated Title",
      status: "published",
    })

    expect(updated.title).toBe("Updated Title")
    expect(updated.status).toBe("published")
    expect(updated.id).toBe(post.id)
  })

  it("searches published posts", async () => {
    const results = await searchPosts("Integration Test")
    expect(results.some((p) => p.id === post.id)).toBe(true)
  })

  it("returns null for a missing slug", async () => {
    const found = await getPostBySlug("definitely-missing-slug-12345")
    expect(found).toBeNull()
  })
})

describeIfEnabled("public blog data layer", () => {
  const draftSlug = `test-draft-${Date.now()}-${Math.floor(Math.random() * 100000)}`
  const publishedSlug = `test-published-${Date.now()}-${Math.floor(Math.random() * 100000)}`
  let draftPost: Post
  let publishedPost: Post

  beforeAll(async () => {
    const draftSource = `---
title: Draft Test Post
excerpt: Should not appear publicly
category: testing
tags:
  - public-blog-test
---

# Draft Test

This post is a draft and should be hidden from public pages.
`
    const publishedSource = `---
title: Published Test Post
excerpt: Should appear publicly
category: testing
tags:
  - public-blog-test
status: published
published_at: 2024-01-01T00:00:00.000Z
---

# Published Test

This post is published and should appear on public pages.
`
    const draftPrepared = await parseAndPreparePost(draftSource)
    const publishedPrepared = await parseAndPreparePost(publishedSource)

    draftPost = await createPost({ ...draftPrepared, slug: draftSlug })
    publishedPost = await createPost({ ...publishedPrepared, slug: publishedSlug })
  })

  afterAll(async () => {
    if (draftPost?.id) await deletePost(draftPost.id)
    if (publishedPost?.id) await deletePost(publishedPost.id)
  })

  it("getPublishedPostBySlug returns a published post", async () => {
    const found = await getPublishedPostBySlug(publishedSlug)
    expect(found).not.toBeNull()
    expect(found?.id).toBe(publishedPost.id)
    expect(found?.slug).toBe(publishedSlug)
  })

  it("getPublishedPostBySlug returns null for a draft post", async () => {
    const found = await getPublishedPostBySlug(draftSlug)
    expect(found).toBeNull()
  })

  it("getPublishedPostBySlug returns null for a missing slug", async () => {
    const found = await getPublishedPostBySlug("definitely-missing-slug-public")
    expect(found).toBeNull()
  })

  it("getPosts with status published excludes drafts", async () => {
    const published = await getPosts({ status: "published", limit: 100 })
    expect(published.some((p) => p.id === publishedPost.id)).toBe(true)
    expect(published.some((p) => p.id === draftPost.id)).toBe(false)
  })

  it("searchPosts excludes draft posts", async () => {
    const results = await searchPosts("public-blog-test")
    expect(results.some((p) => p.id === publishedPost.id)).toBe(true)
    expect(results.some((p) => p.id === draftPost.id)).toBe(false)
  })
})
