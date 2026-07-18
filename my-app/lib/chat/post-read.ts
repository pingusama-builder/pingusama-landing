import { getPosts, getPublishedPostBySlug, type Post } from "@/lib/db/posts"

// Companion post-reading — closes the "review my new blog post" gap.
//
// Root cause (2026-07-19 debug log chat-692453d3): the blog site context
// (lib/chat/awareness.ts readBlogSource) is an INDEX only — slug/title/category/
// date/tags/excerpt. The post BODY (content_markdown) lives in Supabase `posts`
// and is one query away (getPublishedPostBySlug), but nothing in the chat path
// read it. Asked to review a post, the companion either hallucinated a critique
// (mistral-small, fabricated quotes) or asked the user to paste their own post.
//
// This module is the fix: a read-only fetch + a deterministic intent detector.
//
// Security: imports ONLY getPosts + getPublishedPostBySlug from @/lib/db/posts.
// No createPost/updatePost/deletePost. The chat path already imports
// @/lib/db/posts (awareness.ts), so this adds NO new reach across the site-write
// boundary. Post text is delivered to the model as read-only prompt/tool
// content — NEVER passed to saveMemory/infer, NEVER rendered as raw HTML.

/** Hard cap on the post body injected into the prompt / returned by the tool.
 *  Posts are short personal essays; 12k chars is generous and bounds context. */
export const POST_BODY_MAX_CHARS = 12000

// ── Intent detection (deterministic, input-side) ───────────────────────────
// Fires the auto-inject of the newest post body ONLY on a high-precision "new
// post" phrase, so we don't bloat every turn that happens to mention "post".
// This is the MECHANICAL guard that holds on a non-reasoning substrate; the
// output-side "read before you comment" prompt clause is a steer, not a
// guarantee. Bare "my post" (no new/newest/latest) deliberately does NOT match
// — that path uses the read_post tool on demand, not the auto-inject.
const POST_REVIEW_INTENT =
  /\b((my|the|this|a)\s+new\s+(blog\s+)?post|new\s+blog\s+post|(my|the)\s+(newest|latest|most recent)\s+(blog\s+)?post)\b/i

export function detectPostReviewIntent(message: string): boolean {
  return POST_REVIEW_INTENT.test(message)
}

// ── Formatting (pure) ──────────────────────────────────────────────────────
function capBody(body: string): string {
  const text = body ?? ""
  if (text.length <= POST_BODY_MAX_CHARS) return text
  return text.slice(0, POST_BODY_MAX_CHARS) + "\n\n…[truncated]"
}

export function formatPostForPrompt(post: Post): string {
  const tags = post.tags && post.tags.length ? ` [${post.tags.join(", ")}]` : ""
  const cat = post.category ? ` — ${post.category}` : ""
  const date = post.published_at ? ` · ${post.published_at.slice(0, 10)}` : ""
  return `**${post.title}**${cat}${date}${tags}\nSlug: ${post.slug}\n\n${capBody(post.content_markdown ?? "")}`
}

// ── Tool fetch (read-only) ─────────────────────────────────────────────────
/** Read a post for the read_post tool. slug omitted/blank → newest published. */
export async function readPostForTool(opts: { slug?: string }): Promise<string> {
  const slug = opts.slug?.trim()
  if (slug) {
    const post = await getPublishedPostBySlug(slug)
    if (!post) return `No published post found for slug "${slug}".`
    return formatPostForPrompt(post)
  }
  const [newest] = await getPosts({ status: "published", limit: 1 })
  if (!newest) return "No published posts yet."
  return formatPostForPrompt(newest)
}

// ── Route auto-inject (newest post, for post-review intent) ────────────────
/** Load the newest published post formatted for the system prompt, or null
 *  when there are no published posts or the fetch fails (fail-closed — the
 *  read_post tool remains the fallback). */
export async function loadNewestPostForPrompt(): Promise<string | null> {
  try {
    const [newest] = await getPosts({ status: "published", limit: 1 })
    if (!newest) return null
    return formatPostForPrompt(newest)
  } catch {
    return null
  }
}