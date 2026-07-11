import { describe, it, expect } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MarkdownText } from "@/components/MarkdownText"

// Render to an HTML string in node (no DOM env needed). This proves the actual
// markup the safe renderer emits — emphasis, lists, and the security properties
// (no raw HTML, links disabled) — rather than just that the file imports a lib.
const render = (text: string) =>
  renderToStaticMarkup(React.createElement(MarkdownText, null, text))

describe("MarkdownText — emphasis + GFM rendering", () => {
  it("renders **bold** as <strong>", () => {
    expect(render("**bold**")).toContain("<strong>bold</strong>")
  })

  it("renders *italic* as <em>", () => {
    expect(render("*italic*")).toContain("<em>italic</em>")
  })

  it("renders `code` as <code>", () => {
    expect(render("`code`")).toContain("<code>code</code>")
  })

  it("renders GFM bullet lists as <ul><li>", () => {
    const html = render("- one\n- two")
    expect(html).toContain("<li>one</li>")
    expect(html).toContain("<li>two</li>")
  })
})

describe("MarkdownText — security (untrusted model output)", () => {
  it("does NOT execute or pass through raw HTML — <script> is escaped, not rendered", () => {
    const html = render("hi <script>alert(1)</script> there")
    expect(html).not.toMatch(/<script/i)
    // the literal text is preserved as escaped content, not dropped
    expect(html).toContain("alert(1)")
  })

  it("disables javascript: links — no <a> anchor, link text shown as plain text", () => {
    const html = render("[click me](javascript:alert(1))")
    expect(html).not.toContain("<a")
    expect(html).toContain("click me")
  })

  it("disables http(s) links too — text shown, no clickable anchor", () => {
    const html = render("[a site](https://example.com)")
    expect(html).not.toContain("<a")
    expect(html).toContain("a site")
  })
})