import { getPublishedTinkerEntries, TinkerEntry, TinkerSource } from "@/lib/db/tinker"

// Public read of published 燈工房 entries. Returns the shape tinker.html
// expects: { entries: [{ topic, project, harness, date, prompt, source }] }.
// `date` is derived from created_at (the trove has no separate publish date).
// Service-client read with an explicit status='published' filter; the table's
// RLS also exposes only published to anon/authenticated as defence-in-depth.
export const runtime = "nodejs"

// Exported for tests (tests/unit/tinker-public-source.test.ts). Not used by
// the route's own GET beyond toPublicShape below.
export function toPublicSource(s: TinkerSource | null) {
  if (!s) return null
  // Expose only what the public room renders. Raw `markdown` is intentionally
  // dropped — the sanitized `markdown_html` render cache is enough to display,
  // and keeping raw markdown out of the public payload mirrors the blog (which
  // ships content_html, not content_markdown, to readers).
  const out: Record<string, string> = {}
  if (s.label) out.label = s.label
  if (s.url) out.url = s.url
  if (s.path) out.path = s.path
  if (s.note) out.note = s.note
  if (s.markdown_html) out.markdown_html = s.markdown_html
  return Object.keys(out).length > 0 ? out : null
}

function toPublicShape(entry: TinkerEntry) {
  return {
    id: entry.id,
    slug: entry.slug,
    topic: entry.topic,
    project: entry.project,
    harness: entry.harness,
    date: entry.created_at ? entry.created_at.slice(0, 10) : null,
    prompt: entry.prompt,
    source: toPublicSource(entry.source),
  }
}

export async function GET() {
  try {
    const entries = await getPublishedTinkerEntries()
    return Response.json({ entries: entries.map(toPublicShape) })
  } catch {
    // Graceful degradation: if the tinker_entries table is not yet applied
    // (e.g. local smoke before the migration runs), return an empty list so
    // the public page renders "工房未有 entry" instead of crashing. Real
    // errors still surface in the admin editor's save path.
    return Response.json({ entries: [] })
  }
}