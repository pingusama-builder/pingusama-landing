import { describe, expect, test } from "vitest"
import { toPublicSource } from "@/app/api/tinker-entries/route"
import type { TinkerSource } from "@/lib/db/tinker"

// Pins the public 來源 contract for the 燈工房 markdown-text feature:
//   - raw `markdown` is NEVER shipped to the public payload (only the
//     server-sanitized `markdown_html` render cache is), mirroring the blog
//     shipping content_html not content_markdown;
//   - label / url / path / note pass through unchanged;
//   - an all-empty source collapses to null so tinker.html renders no 來源 block.
// toPublicSource is a pure function — no Supabase env needed (importing the
// route module does not invoke createServiceClient at module load).

describe("toPublicSource (public 來源 shape)", () => {
  test("keeps markdown_html and drops raw markdown", () => {
    const src: TinkerSource = {
      label: "transcript",
      markdown: "# raw heading\n\n**secret** draft notes",
      markdown_html: "<h1>raw heading</h1><p><strong>secret</strong> draft notes</p>",
    }
    const out = toPublicSource(src) as Record<string, string>

    expect(out.markdown_html).toContain("<h1>raw heading</h1>")
    expect(out.label).toBe("transcript")
    // the raw markdown must not leak to the public payload
    expect(out.markdown).toBeUndefined()
    expect(out).not.toHaveProperty("markdown")
  })

  test("passes label / url / path / note through", () => {
    const out = toPublicSource({
      label: "L",
      url: "https://example.com/t.md",
      path: "repo/t.md",
      note: "a note",
    }) as Record<string, string>

    expect(out).toEqual({
      label: "L",
      url: "https://example.com/t.md",
      path: "repo/t.md",
      note: "a note",
    })
  })

  test("renders a markdown-only source (no label/url/path)", () => {
    const out = toPublicSource({
      markdown: "# x",
      markdown_html: "<h1>x</h1>",
    }) as Record<string, string>

    expect(out.markdown_html).toBe("<h1>x</h1>")
    expect(out.markdown).toBeUndefined()
    expect(Object.keys(out)).toEqual(["markdown_html"])
  })

  test("collapses an all-empty source to null", () => {
    expect(toPublicSource({})).toBeNull()
    expect(toPublicSource(null)).toBeNull()
  })

  test("drops empty-string fields (whitespace-only note/url/etc.)", () => {
    // The save action trims before storing, but the public shape must still be
    // resilient if a stale row has empty strings: only truthy fields survive.
    expect(toPublicSource({ label: "", url: "", note: "", markdown_html: "" })).toBeNull()
  })
})