/* eslint-disable @typescript-eslint/no-explicit-any */
// Builds lib/data/code-map.json — a structural map of the site's code for the
// chatbot's `read_code` tool. SERVERLESS-SAFE: prebuilt at build time, so the
// bot can understand features without runtime FS access.
//
// SECURITY: this map is fed to the LLM as context, so it must never contain
// secrets. Only an explicit allowlist of small safe files gets full content;
// everything else gets path + leading-comment purpose + export names. We
// never read .env* or anything outside app/ components/ lib/. The bot has no
// general "read file by path" tool — only read_code over this map.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, relative, extname, basename } from "node:path"
import { TOOLS } from "../lib/tools"

const ROOT = join(process.cwd())
const OUT = join(ROOT, "lib", "data", "code-map.json")

// Full-content allowlist (small, secret-free files the bot may read in full).
const KEY_FILES = [
  "lib/tools.ts",
  "lib/categories.ts",
  "lib/data/shelf.json",
  "lib/data/vault.json",
]

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const name of entries) {
    const full = join(dir, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      // skip noise
      if (name === "node_modules" || name === ".next" || name === ".git") continue
      walk(full, acc)
    } else if (st.isFile()) {
      acc.push(relative(ROOT, full).replace(/\\/g, "/"))
    }
  }
  return acc
}

function leadingPurpose(content: string): string | undefined {
  // First line that's a // comment or a * doc line, trimmed.
  const lines = content.split(/\r?\n/)
  for (const raw of lines.slice(0, 8)) {
    const line = raw.trim()
    if (!line) continue
    const m1 = line.match(/^\/\/\s?(.*)$/)
    if (m1) return m1[1] || undefined
    const m2 = line.match(/^\*\s?(.*)$/)
    if (m2) return m2[1] || undefined
    if (line.startsWith("/*")) {
      const inner = line.replace(/^\/\*+/, "").replace(/\*+\/$/, "").trim()
      return inner || undefined
    }
    break
  }
  return undefined
}

function exportsOf(content: string): string[] {
  const out = new Set<string>()
  const re = /export\s+(?:async\s+)?(?:function|const|let|var|type|interface|class)\s+([A-Za-z_][\w]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) out.add(m[1])
  return [...out]
}

function read(path: string): string | null {
  try {
    return readFileSync(join(ROOT, path), "utf8")
  } catch {
    return null
  }
}

function deriveRoutePath(file: string): string {
  // app/blog/[slug]/page.tsx -> /blog/:slug ; app/page.tsx -> /
  let p = file.replace(/^app\//, "").replace(/\/page\.tsx$/, "").replace(/^page\.tsx$/, "")
  if (!p) return "/"
  p = "/" + p
  p = p.replace(/\[([^\]]+)\]/g, ":$1")
  return p
}

function main() {
  const files = new Set(walk("app").concat(walk("components")).concat(walk("lib")))

  const routes: any[] = []
  const components: any[] = []
  const lib: any[] = []
  const dataSources: any[] = []

  for (const f of [...files].sort()) {
    if (extname(f) !== ".ts" && extname(f) !== ".tsx") continue
    const content = read(f)
    if (!content) continue
    const purpose = leadingPurpose(content)

    if (f.startsWith("app/") && (f.endsWith("page.tsx") || f.endsWith("route.ts"))) {
      const isApi = f.endsWith("route.ts")
      routes.push({
        path: deriveRoutePath(f) + (isApi ? " (API)" : ""),
        file: f,
        purpose,
      })
    } else if (f.startsWith("components/")) {
      components.push({
        name: basename(f).replace(extname(f), ""),
        file: f,
        purpose,
      })
    } else if (f.startsWith("lib/")) {
      const entry = { file: f, purpose, exports: exportsOf(content) }
      lib.push(entry)
      if (f.startsWith("lib/db/")) {
        dataSources.push({ name: basename(f).replace(extname(f), ""), file: f, desc: purpose })
      }
    }
  }

  const tools = Object.entries(TOOLS).map(([id, t]) => ({
    id,
    title: t.title,
    status: t.status,
    href: t.href,
  }))

  // Env var NAMES only (from .env.example — never .env.local, never values).
  const envVars: any[] = []
  const example = read(".env.example")
  if (example) {
    for (const line of example.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=/)
      if (m) {
        envVars.push({
          name: m[1],
          required: true,
          public: m[1].startsWith("NEXT_PUBLIC_"),
        })
      }
    }
  }

  const keyFiles = KEY_FILES.map((p) => ({ path: p, content: read(p) ?? "" })).filter(
    (f) => f.content.length > 0
  )

  const map = {
    generatedAt: new Date().toISOString(),
    routes,
    components,
    lib,
    dataSources,
    tools,
    envVars,
    keyFiles,
  }

  writeFileSync(OUT, JSON.stringify(map, null, 2) + "\n", "utf8")
  console.log(
    `Wrote ${OUT}: ${routes.length} routes, ${components.length} components, ${lib.length} lib, ${tools.length} tools, ${keyFiles.length} key files, ${envVars.length} env vars`
  )
}

main()