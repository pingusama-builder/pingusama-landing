import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { getPosts, type Post } from "@/lib/db/posts"
import { loadShelf, loadVault } from "@/lib/db/bench"
import { resolveShelf } from "@/lib/books"
import { TOOLS } from "@/lib/tools"
import { upsertSiteAwareness } from "@/lib/db/chat"

// ── Site awareness: build context + keep per-category memories fresh ────
// Two separate ideas:
//  • buildSiteContext() — reads LIVE source every turn so the prompt always
//    carries current site state (ground truth). Single chokepoint: swap to a
//    digest+fetch strategy later without touching callers.
//  • refreshAwareness() — deterministic (no LLM) sync of the `site:*` memories:
//    diffs live source vs the stored fingerprint, rewrites the memory, notes
//    what changed. This is the change-tracking a browser-bound Gemini lacks.

export type SiteCategory = "blog" | "shelf" | "vault" | "tools" | "code"
const ALL_CATEGORIES: SiteCategory[] = ["blog", "shelf", "vault", "tools", "code"]

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)
}

// ── Live source readers ──────────────────────────────────────────────────
async function readBlogSource(): Promise<{
  content: string
  keys: string[]
  fingerprint: string
  description: string
}> {
  const posts = await getPosts({ status: "published", limit: 200 })
  const keys = posts.map((p) => p.slug)
  const lines = posts.map((p) => {
    const tags = p.tags && p.tags.length ? ` [${p.tags.join(", ")}]` : ""
    const cat = p.category ? ` — ${p.category}` : ""
    const date = p.published_at ? ` · ${p.published_at.slice(0, 10)}` : ""
    const excerpt = p.excerpt ? `: ${p.excerpt}` : ""
    return `- /blog/${p.slug} — ${p.title}${cat}${date}${tags}${excerpt}`
  })
  const content = `# Blog — published posts (${posts.length})\n${lines.join("\n") || "_No published posts yet._"}`
  return {
    content,
    keys,
    fingerprint: hash(keys),
    description: "Site awareness: blog — index of published posts",
  }
}

async function readShelfSource(): Promise<{
  content: string
  keys: string[]
  fingerprint: string
  description: string
}> {
  const shelf = await loadShelf()
  const resolved = await resolveShelf(shelf)
  const fmt = (b: { title: string; authors: string[]; note: string; isbn13: string | null }) => {
    const authors = b.authors.length ? ` — ${b.authors.join(", ")}` : ""
    return `- ${b.title}${authors} (ISBN ${b.isbn13 ?? "?"}) — note: ${b.note}`
  }
  const cr = resolved.currentlyReading.map(fmt)
  const tbr = resolved.tbr.map(fmt)
  const errs = resolved.errors.map((e) => `- ! ${e.isbn13}: ${e.reason}`)
  const content = `# Shelf\n## Currently reading\n${cr.join("\n") || "_none_"}\n\n## To read (TBR)\n${tbr.join("\n") || "_none_"}${
    errs.length ? `\n\n## Not warmed\n${errs.join("\n")}` : ""
  }`
  const keys = [
    ...shelf.currentlyReading.map((e) => e.isbn13),
    ...shelf.tbr.map((e) => e.isbn13),
  ]
  return {
    content,
    keys,
    fingerprint: hash(keys),
    description: "Site awareness: shelf — currently reading + TBR with notes",
  }
}

async function readVaultSource(): Promise<{
  content: string
  keys: string[]
  fingerprint: string
  description: string
}> {
  const vault = await loadVault()
  const keys = vault.clips.map((c) => c.title)
  const lines = vault.clips.map(
    (c) => `- ${c.title} — ${c.source} · ${c.date}${c.note ? ` — ${c.note}` : ""}`
  )
  const content = `# Vault — clipped links (${vault.clips.length})\n${lines.join("\n") || "_No clips yet._"}`
  return {
    content,
    keys,
    fingerprint: hash(keys),
    description: "Site awareness: vault — clipped links with notes",
  }
}

function readToolsSource(): {
  content: string
  keys: string[]
  fingerprint: string
  description: string
} {
  const entries = Object.entries(TOOLS)
  const keys = entries.map(([id]) => id)
  const lines = entries.map(
    ([id, t]) => `- ${id}: ${t.title} (${t.status}) — ${t.desc} → ${t.href}`
  )
  return {
    content: `# Tool wheel (${entries.length})\n${lines.join("\n")}`,
    keys,
    fingerprint: hash(entries),
    description: "Site awareness: tools — the wheel of makings",
  }
}

// ── Code map (prebuilt by scripts/build-code-map.ts) ──────────────────────
export interface CodeMap {
  generatedAt: string
  routes: { path: string; file: string; purpose?: string }[]
  components: { name: string; file: string; purpose?: string }[]
  lib: { file: string; purpose?: string; exports?: string[] }[]
  dataSources: { name: string; file: string; desc?: string }[]
  tools: { id: string; title: string; status: string; href: string }[]
  envVars: { name: string; required: boolean; public: boolean }[]
  keyFiles: { path: string; content: string }[]
}

const CODE_MAP_PATH = join(process.cwd(), "lib", "data", "code-map.json")

export function loadCodeMap(): CodeMap | null {
  try {
    const raw = readFileSync(CODE_MAP_PATH, "utf8")
    return JSON.parse(raw) as CodeMap
  } catch {
    return null
  }
}

function readCodeSource(): {
  content: string
  keys: string[]
  fingerprint: string
  description: string
} {
  const map = loadCodeMap()
  if (!map) {
    return {
      content: "# Code\n_Code map not built yet. Run `npm run build-code-map`._",
      keys: [],
      fingerprint: hash("no-map"),
      description: "Site awareness: code — feature model (not built)",
    }
  }
  const keys = [...map.routes.map((r) => r.path), ...map.components.map((c) => c.name)]
  const routes = map.routes.map((r) => `- ${r.path} ← ${r.file}${r.purpose ? ` — ${r.purpose}` : ""}`)
  const comps = map.components.map((c) => `- ${c.name} ← ${c.file}${c.purpose ? ` — ${c.purpose}` : ""}`)
  const libs = map.lib.map((l) => `- ${l.file}${l.purpose ? ` — ${l.purpose}` : ""}`)
  const envs = map.envVars.map((e) => `- ${e.name}${e.public ? " (public)" : ""}`)
  const content = `# Code — feature model (generated ${map.generatedAt})\n## Routes (${map.routes.length})\n${routes.join("\n")}\n\n## Components (${map.components.length})\n${comps.join("\n")}\n\n## Lib (${map.lib.length})\n${libs.join("\n")}\n\n## Data sources (${map.dataSources.length})\n${map.dataSources.map((d) => `- ${d.name} ← ${d.file}${d.desc ? ` — ${d.desc}` : ""}`).join("\n")}\n\n## Env vars (${map.envVars.length})\n${envs.join("\n")}`
  return {
    content,
    keys,
    fingerprint: hash(keys),
    description: "Site awareness: code — feature model of the site",
  }
}

// ── buildSiteContext: the prompt's live site digest ──────────────────────
export async function buildSiteContext(): Promise<string> {
  const [blog, shelf, vault, code] = await Promise.all([
    readBlogSource(),
    readShelfSource(),
    readVaultSource(),
    Promise.resolve(readCodeSource()),
  ])
  const tools = readToolsSource()
  return [
    "# SITE CONTEXT (live, read-only — you cannot edit any of this)",
    "This is Pingusama's Tinkering — a personal workshop site. Current state:",
    "",
    tools.content,
    "",
    blog.content,
    "",
    shelf.content,
    "",
    vault.content,
    "",
    code.content,
  ].join("\n")
}

// ── refreshAwareness: deterministic per-category sync ─────────────────────
export interface AwarenessRefreshResult {
  category: SiteCategory
  changed: boolean
  added: string[]
  removed: string[]
  syncedAt: string
}

export async function refreshAwareness(opts: {
  category?: SiteCategory
  sourceThreadId?: string
} = {}): Promise<AwarenessRefreshResult[]> {
  const cats = opts.category ? [opts.category] : ALL_CATEGORIES
  const out: AwarenessRefreshResult[] = []
  for (const category of cats) {
    const src =
      category === "blog"
        ? await readBlogSource()
        : category === "shelf"
          ? await readShelfSource()
          : category === "vault"
            ? await readVaultSource()
            : category === "tools"
              ? readToolsSource()
              : readCodeSource()
    const res = await upsertSiteAwareness({ category, ...src })
    out.push({
      category,
      changed: res.changed,
      added: res.added,
      removed: res.removed,
      syncedAt: new Date().toISOString(),
    })
  }
  return out
}

// ── readCode: bot tool to look up a feature in the code map ──────────────
export function readCode(query?: { feature?: string; path?: string }): string {
  const map = loadCodeMap()
  if (!map) return "Code map not built. Run `npm run build-code-map`."
  if (query?.path) {
    const kf = map.keyFiles.find((f) => f.path === query.path)
    if (kf) return `// ${kf.path}\n${kf.content}`
    const lib = map.lib.find((l) => l.file === query.path)
    if (lib) return `${lib.file}${lib.purpose ? ` — ${lib.purpose}` : ""}${lib.exports ? `\nexports: ${lib.exports.join(", ")}` : ""}`
    return `No code entry for path "${query.path}".`
  }
  if (query?.feature) {
    const f = query.feature.toLowerCase()
    const r = map.routes.find((x) => x.path.toLowerCase().includes(f) || (x.purpose ?? "").toLowerCase().includes(f))
    if (r) return `Route ${r.path} ← ${r.file}${r.purpose ? ` — ${r.purpose}` : ""}`
    const c = map.components.find((x) => x.name.toLowerCase().includes(f) || (x.purpose ?? "").toLowerCase().includes(f))
    if (c) return `Component ${c.name} ← ${c.file}${c.purpose ? ` — ${c.purpose}` : ""}`
    const l = map.lib.find((x) => x.file.toLowerCase().includes(f) || (x.purpose ?? "").toLowerCase().includes(f))
    if (l) return `Lib ${l.file}${l.purpose ? ` — ${l.purpose}` : ""}${l.exports ? `\nexports: ${l.exports.join(", ")}` : ""}`
    return `No code entry matches "${query.feature}".`
  }
  // Whole-map summary
  return readCodeSource().content
}