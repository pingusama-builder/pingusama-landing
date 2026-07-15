import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const files: Record<string, string> = {
  route: fileURLToPath(new URL("../../app/api/chat/route.ts", import.meta.url)),
  tavily: fileURLToPath(new URL("../../lib/chat/tavily-search.ts", import.meta.url)),
  rewrite: fileURLToPath(new URL("../../lib/chat/query-rewrite.ts", import.meta.url)),
  tools: fileURLToPath(new URL("../../lib/chat/tools.ts", import.meta.url)),
  webTrigger: fileURLToPath(new URL("../../lib/chat/web-trigger.ts", import.meta.url)),
}

function src(name: keyof typeof files): string {
  return readFileSync(files[name], "utf8")
}

// Strip comments so the identifier guard targets real code, not the
// security-documentation comments that name the very boundary they enforce.
// FORBIDDEN_IMPORTS is matched on raw source (import statements are never in
// comments and the regexes require `from "…"` syntax).
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
}

// The web-search chat path must not import site-write functions or the generic
// service client. lib/db/chat (the chat data layer) is allowed; the web path
// imports lib/db/chat, not the service client directly.
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

describe("web-search chat path — no site-write imports", () => {
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

describe("web-search chat path — web text never persisted to memory", () => {
  it("route never calls a memory-persist function directly", () => {
    const code = stripComments(src("route"))
    // saveMemory / inferMemoriesFromThread are the memory-persist entry points.
    // The web path must not flow extracted page text into either.
    expect(code).not.toMatch(/\bsaveMemory\s*\(/)
    expect(code).not.toMatch(/\binferMemoriesFromThread\s*\(/)
    expect(code).not.toMatch(/from\s+["']@\/lib\/chat\/infer["']/)
  })

  it("route delivers web evidence only through formatWebEvidenceGuarded", () => {
    const code = stripComments(src("route"))
    // The extracted page text is bound into the turn exclusively via the
    // guarded evidence formatter (which enforces the subject-absent guard and
    // the "not memory / not site content" reminder).
    expect(code).toMatch(/formatWebEvidenceGuarded\s*\(/)
    // And never raw-appended to a memory/site write:
    expect(code).not.toMatch(/appendMessage[\s\S]{0,80}pages/)
  })

  it("tavily-search declares the no-persistence boundary in its header", () => {
    // The module header documents that it performs no site writes and no
    // memory writes — a tripwire if a future edit silently drops that contract.
    const raw = src("tavily")
    expect(raw).toMatch(/never persisted to memory/i)
    expect(raw).toMatch(/no site content|not site content|never written to site/i)
  })
})

describe("web_search + web-trigger — the new auto-search-decision surface", () => {
  it("web-trigger imports no tavily / site-write / generic service client", () => {
    const raw = src("webTrigger")
    // The needs-web? classifier must not reach the web itself (it only decides
    // whether the route will), and must not touch site-write functions.
    expect(raw).not.toMatch(/from\s+["']@\/lib\/chat\/tavily-search["']/)
    for (const re of FORBIDDEN_IMPORTS) {
      expect(raw, `web-trigger must not match ${re}`).not.toMatch(re)
    }
    for (const id of FORBIDDEN_IDENTIFIERS) {
      expect(stripComments(raw), `web-trigger must not reference "${id}"`).not.toContain(id)
    }
  })

  it("tools web_search path delivers evidence only through formatWebEvidenceGuarded", () => {
    const code = stripComments(src("tools"))
    // The in-tool follow-up search binds its result exclusively through the
    // guarded formatter (subject-absent guard + "not memory" reminder) — never
    // raw-appended to a memory or site write.
    expect(code).toMatch(/formatWebEvidenceGuarded\s*\(/)
    expect(code).not.toMatch(/saveMemory[\s\S]{0,120}formatWebEvidenceGuarded/)
  })

  it("tools commits a web-sourced memory only through the gate (source: \"web\")", () => {
    const code = stripComments(src("tools"))
    // A web→memory save must pass gateWebSave (mechanical precheck + reasoning
    // gate). On gate success the save is stamped via saveSource = "web" and
    // passed to saveMemory as source: saveSource; on refusal the function
    // returns early without saving. The non-web save_memory path leaves
    // saveSource = "chat" — a web stamp is never hardcoded into the save call.
    expect(code).toMatch(/gateWebSave/)
    expect(code).toMatch(/saveSource\s*=\s*["']web["']/)
    expect(code).toMatch(/source:\s*saveSource/)
    // The reasoning gate uses the reasoning model via mistralTurn (not a tool
    // call, not a stream) — and only on the web-touched branch.
    expect(code).toMatch(/getReasoningModel/)
    // And a refused gate never reaches saveMemory on that branch.
    expect(code).toMatch(/Web→memory save refused/)
  })
})