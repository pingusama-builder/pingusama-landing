import { describe, it, expect } from "vitest"
import { parseMarkdown } from "@/lib/markdown"

describe("parseMarkdown", () => {
  it("parses YAML frontmatter and returns data object", async () => {
    const source = `---
title: Hello World
draft: true
tags:
  - one
  - two
---

# Body here
`
    const result = await parseMarkdown(source)

    expect(result.data.title).toBe("Hello World")
    expect(result.data.draft).toBe(true)
    expect(result.data.tags).toEqual(["one", "two"])
    expect(result.html).toContain("<h1>Body here</h1>")
  })

  it("converts markdown body to sanitized HTML", async () => {
    const source = `# Title

Paragraph with **bold** and [a link](https://example.com).`
    const result = await parseMarkdown(source)

    expect(result.html).toContain("<h1>Title</h1>")
    expect(result.html).toContain("<strong>bold</strong>")
    expect(result.html).toContain('href="https://example.com"')
    expect(result.html).toContain("<a")
  })

  it("handles tables via GFM", async () => {
    const source = `| Name | Value |
|------|-------|
| A    | 1     |
| B    | 2     |`
    const result = await parseMarkdown(source)

    expect(result.html).toContain("<table>")
    expect(result.html).toContain("<td>A</td>")
    expect(result.html).toContain("<td>2</td>")
  })

  it("handles raw HTML and sanitizes dangerous tags/script", async () => {
    const source = `<div>Hello div</div>

<script>alert('xss')</script>

Text after script.
`
    const result = await parseMarkdown(source)

    expect(result.html).not.toContain("<script>")
    expect(result.html).not.toContain("alert('xss')")
    expect(result.html).not.toContain("<div>Hello div</div>")
    expect(result.html).toContain("Text after script")
  })

  it("returns excerpt from frontmatter if provided", async () => {
    const source = `---
excerpt: A custom hand-written excerpt.
---

# Title

Body paragraph that would otherwise be used for the excerpt.
`
    const result = await parseMarkdown(source)

    expect(result.excerpt).toBe("A custom hand-written excerpt.")
  })

  it("returns auto-excerpt when no excerpt frontmatter", async () => {
    const source = `# Title

First paragraph with **bold** and [a link](https://example.com). It has enough text to stay under the limit.

Second paragraph should not appear.`
    const result = await parseMarkdown(source)

    expect(result.excerpt).toContain("First paragraph")
    expect(result.excerpt).not.toContain("Second paragraph")
    expect(result.excerpt).not.toContain("#")
    expect(result.excerpt).not.toContain("[")
    expect(result.excerpt?.length).toBeLessThanOrEqual(160)
  })
})
