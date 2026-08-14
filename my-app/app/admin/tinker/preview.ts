"use server"

import { parseMarkdown } from "@/lib/markdown"

// Live preview for the 燈工房 source markdown textarea — same rehype-sanitize
// pipeline the blog editor uses (app/admin/blog/preview.ts) so what the admin
// sees here matches what the public room renders from `source.markdown_html`.
export async function previewTinkerSourceMarkdown(markdown: string): Promise<string> {
  const { html } = await parseMarkdown(markdown)
  return html
}