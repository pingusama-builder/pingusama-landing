import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseMarkdown } from "@/lib/markdown"
import {
  applyProposalToForm,
  draftRevision,
  type DraftSnapshot,
} from "@/lib/blog/proposals"

// Adversarial payloads a prompt-injected draft or a propose_edit replacement
// could carry. The renderer (parseMarkdown + rehypeSanitize) is the boundary,
// independent of the companion — these prove it holds.
const PAYLOADS = [
  "<script>alert(1)</script>",
  '<img src=x onerror="alert(1)">',
  '<a href="javascript:alert(1)">click</a>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<object data="evil.swf"></object>',
  "<embed src=\"evil.swf\">",
  '<svg onload="alert(1)"><rect/></svg>',
  "<<img src=1 onerror=alert(1)>>",
  "<scr<script>ipt>alert(1)</scr</script>ipt>",
  "&lt;script&gt;alert(1)&lt;/script&gt;",
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
]

describe("parseMarkdown — publish-boundary XSS (spec §10)", () => {
  it.each(PAYLOADS)("drops/sanitizes payload: %s", async (payload) => {
    const { html } = await parseMarkdown(payload)
    // No executable tags:
    expect(html).not.toMatch(/<script[\s>]/i)
    expect(html).not.toMatch(/<iframe[\s>]/i)
    expect(html).not.toMatch(/<object[\s>]/i)
    expect(html).not.toMatch(/<embed[\s>]/i)
    expect(html).not.toMatch(/<svg[\s>]/i)
    // No event-handler attributes on any real tag:
    expect(html).not.toMatch(/<\w+[^>]*\son\w+\s*=/i)
    // No javascript: / data:html URLs in attributes:
    expect(html).not.toMatch(/(href|src)\s*=\s*["']?\s*(javascript|data:text\/html):/i)
  })
})

describe("propose_edit replacement → render boundary (spec §10)", () => {
  it("a body replacement carrying an XSS payload, applied + rendered, is sanitized", async () => {
    const draft: DraftSnapshot = {
      content_markdown: "clean passage.",
      title: "T",
      excerpt: "",
      meta_description: "",
    }
    const proposal = {
      id: "p",
      field: "body" as const,
      original: "clean passage.",
      replacement: '<script>alert(1)</script><img src=x onerror=alert(1)>',
      rationale: "r",
      principleId: "O4",
      baseRevision: draftRevision(draft),
      range: { start: 0, end: "clean passage.".length },
    }
    const res = applyProposalToForm(draft, proposal)
    expect(res.ok).toBe(true)
    if (res.ok) {
      const { html } = await parseMarkdown(res.form.content_markdown)
      expect(html).not.toMatch(/<script[\s>]/i)
      expect(html).not.toMatch(/<\w+[^>]*\son\w+\s*=/i)
      expect(html).not.toMatch(/javascript:/i)
    }
  })

  it("a title replacement carrying an XSS payload, applied, is sanitized if ever rendered as markdown", async () => {
    const draft: DraftSnapshot = {
      content_markdown: "body",
      title: "Old",
      excerpt: "",
      meta_description: "",
    }
    const proposal = {
      id: "p",
      field: "title" as const,
      originalValue: "Old",
      replacement: '<script>alert(1)</script>',
      rationale: "r",
      principleId: "SW1",
      baseRevision: draftRevision(draft),
    }
    const res = applyProposalToForm(draft, proposal)
    expect(res.ok).toBe(true)
    if (res.ok) {
      const { html } = await parseMarkdown(res.form.title)
      expect(html).not.toMatch(/<script[\s>]/i)
    }
  })
})

describe("companion UI — model output is inert plain text (spec §7/§13)", () => {
  it("BlogCompanion + the companion route never use dangerouslySetInnerHTML", () => {
    const rels = [
      "../../components/BlogCompanion.tsx",
      "../../app/api/blog-companion/route.ts",
    ]
    for (const rel of rels) {
      const f = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
      expect(f).not.toContain("dangerouslySetInnerHTML")
    }
  })
})