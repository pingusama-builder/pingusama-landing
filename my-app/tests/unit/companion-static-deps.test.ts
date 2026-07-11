import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const files: Record<string, string> = {
  route: fileURLToPath(new URL("../../app/api/blog-companion/route.ts", import.meta.url)),
  tools: fileURLToPath(new URL("../../lib/chat/companion-tools.ts", import.meta.url)),
  writingContext: fileURLToPath(new URL("../../lib/chat/writing-context.ts", import.meta.url)),
  companionPrompt: fileURLToPath(new URL("../../lib/chat/companion-prompt.ts", import.meta.url)),
  proposals: fileURLToPath(new URL("../../lib/blog/proposals.ts", import.meta.url)),
  blogCompanion: fileURLToPath(new URL("../../components/BlogCompanion.tsx", import.meta.url)),
}

function src(name: keyof typeof files): string {
  return readFileSync(files[name], "utf8")
}

// Strip JS/TS comments so the identifier guard targets real code references
// (imports / calls / bindings), not security-documentation comments that name
// the very functions the boundary forbids (see route.ts header comment).
// FORBIDDEN_IMPORTS is matched on the raw source because import statements are
// never inside comments and the regexes require `from "…"` syntax.
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/[^\n]*/g, "") // line comments
}

// The companion path must not import site-write functions or the generic
// service client. (lib/db/chat — the chat data layer — is allowed and is the
// ONLY layer that imports @/lib/supabase/server; the companion path imports
// lib/db/chat, not the service client directly.)
const FORBIDDEN_IDENTIFIERS = [
  "savePostAction",
  "createPost",
  "updatePost",
  "deletePost",
  "deletePostAction",
]
const FORBIDDEN_IMPORTS = [
  /from\s+["']@\/app\/admin\/blog\/actions["']/,
  /from\s+["']@\/lib\/supabase\/server["']/,
  /from\s+["']@\/lib\/supabase\/storage["']/,
  /from\s+["'].*\/(shelf|vault|bench)[^"']*write[^"']*["']/,
]

describe("companion path — no site-write imports (spec §14.1)", () => {
  for (const name of Object.keys(files) as Array<keyof typeof files>) {
    it(`${name} imports no site-write module / generic service client`, () => {
      const raw = src(name)
      const code = stripComments(raw)
      for (const id of FORBIDDEN_IDENTIFIERS) {
        expect(code, `${name} must not reference "${id}"`).not.toContain(id)
      }
      for (const re of FORBIDDEN_IMPORTS) {
        expect(raw, `${name} must not match ${re}`).not.toMatch(re)
      }
    })
  }
})

describe("companion path — no dangerouslySetInnerHTML (spec §7)", () => {
  it("BlogCompanion never uses dangerouslySetInnerHTML on model output", () => {
    expect(src("blogCompanion")).not.toContain("dangerouslySetInnerHTML")
  })
})

describe("companion path — deny-by-default allowlist (spec §5.6)", () => {
  it("companion-tools defines COMPANION_ALLOWED with exactly the three allowed tools", () => {
    const f = src("tools")
    expect(f).toContain("COMPANION_ALLOWED")
    expect(f).toContain('"propose_edit"')
    expect(f).toContain('"save_writing_preference"')
    expect(f).toContain('"set_model"')
    // The chat-only tools are NOT in the companion allowlist source:
    expect(f).not.toMatch(/COMPANION_ALLOWED[\s\S]*?refresh_awareness/)
    expect(f).not.toMatch(/COMPANION_ALLOWED[\s\S]*?read_code/)
  })
})