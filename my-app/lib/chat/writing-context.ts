import { recallMemories } from "@/lib/db/chat"
import { getPosts } from "@/lib/db/posts"

// Narrow, read-only context for the writing companion (second advisor P1-14).
// Deliberately NOT the full buildSiteContext: no shelf/vault/tools/code-map/
// design tokens/full post index — those don't help sentence-level editing and
// add latency, cost, distraction, and an injection surface. Design tokens are
// omitted because they don't improve prose. No read_code tool is exposed.

const EDITORIAL_VOICE =
  "Editorial voice: warm, plain, handcrafted, first-person, terse — a personal workshop site built by its owner. Match the writer's OWN register; do not impose a generic house style or average the voice toward a safe middle."

const MARKDOWN_CONVENTIONS = `Markdown conventions (deterministic; the publish path supports exactly these — raw HTML is stripped on publish):
- Headings: # H1, ## H2, ### H3.
- Paragraphs: blank line between blocks.
- Emphasis: **bold**, _italic_.
- Links: [text](https://url) — http/https only; javascript: is rejected.
- Images: ![alt](https://url) — http/https only.
- Lists: - unordered, 1. ordered.
- Code: \`inline\` and \`\`\`fenced\`\`\` blocks.
- Tables, blockquotes (> ), and other GFM features are supported.
Do NOT propose raw HTML tags; they are stripped before render.`

export async function buildWritingContext(): Promise<string> {
  const [memories, recent] = await Promise.all([
    recallMemories({ limit: 40, includeSite: false }),
    getPosts({ status: "published", limit: 8 }),
  ])

  // Writing preferences live in the "writing-" namespace; feedback memories
  // (how the author wants to be responded to) are also relevant to voice.
  const writingMemories = memories.filter(
    (m) => m.name.startsWith("writing-") || m.type === "feedback"
  )
  const memBlock = writingMemories.length
    ? writingMemories.map((m) => `- ${m.name}: ${m.description} — ${m.content}`).join("\n")
    : "(none yet)"

  const postsBlock = recent.length
    ? recent.map((p) => `- ${p.title}${p.excerpt ? ` — ${p.excerpt}` : ""}`).join("\n")
    : "(none yet)"

  return [
    "# WRITING CONTEXT (read-only — match this register; do NOT imitate content)",
    EDITORIAL_VOICE,
    "",
    "## Recalled writing preferences + feedback (durable; respect these)",
    memBlock,
    "",
    "## A few recent published posts (titles + excerpts only — for register-matching, NOT imitation)",
    postsBlock,
    "",
    MARKDOWN_CONVENTIONS,
  ].join("\n")
}