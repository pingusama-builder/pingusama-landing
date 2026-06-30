import matter from "gray-matter"
import { remark } from "remark"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import rehypeSanitize from "rehype-sanitize"
import rehypeStringify from "rehype-stringify"

export type MarkdownParseResult = {
  data: Record<string, unknown>
  content: string
  excerpt?: string
}

function extractPlainTextExcerpt(content: string): string {
  const stripped = content
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}([^`]*?)`{1,3}/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/(\*\*|\*|__|_)([^*_]+)\1/g, "$2")

  const firstParagraph = stripped
    .split("\n\n")
    .map((block) => block.replace(/\s+/g, " ").trim())
    .find((block) => block.length > 0)

  return (firstParagraph ?? "").slice(0, 160)
}

export async function parseMarkdown(
  source: string,
): Promise<{ data: Record<string, unknown>; html: string; excerpt?: string }> {
  const { data, content } = matter(source) as MarkdownParseResult

  const file = await remark()
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .process(content)

  const html = String(file).trim()
  const excerpt =
    typeof data.excerpt === "string" ? data.excerpt : extractPlainTextExcerpt(content)

  return { data, html, excerpt }
}
