"use server"

import { parseMarkdown } from "@/lib/markdown"

export async function previewMarkdown(markdown: string): Promise<string> {
  const { html } = await parseMarkdown(markdown)
  return html
}
