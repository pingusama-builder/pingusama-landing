import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const files: Record<string, string> = {
  route: fileURLToPath(new URL("../../app/api/chat/route.ts", import.meta.url)),
  tavily: fileURLToPath(new URL("../../lib/chat/tavily-search.ts", import.meta.url)),
  rewrite: fileURLToPath(new URL("../../lib/chat/query-rewrite.ts", import.meta.url)),
  tools: fileURLToPath(new URL("../../lib/chat/tools.ts", import.meta.url)),
  webTrigger: fileURLToPath(new URL("../../lib/chat/web-trigger.ts", import.meta.url)),
  actions: fileURLToPath(new URL("../../app/admin/chat/actions.ts", import.meta.url)),
  messages: fileURLToPath(new URL("../../lib/chat/messages.ts", import.meta.url)),
  debugLog: fileURLToPath(new URL("../../lib/chat/debug-log.ts", import.meta.url)),
  postRead: fileURLToPath(new URL("../../lib/chat/post-read.ts", import.meta.url)),
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

describe("debug-log capture — reasoning never reaches the author SSE", () => {
  it("route wires onReasoning only to a local turnReasoning accumulator", () => {
    const code = stripComments(src("route"))
    expect(code).toMatch(/onReasoning:\s*\(chunk\)\s*=>\s*\{[^}]*turnReasoning\s*\+=\s*chunk/)
  })

  it("no SSE send() object carries a reasoning field", () => {
    const code = stripComments(src("route"))
    expect(code).not.toMatch(/send\(\{[^}]*reasoning/i)
  })

  it("reasoning + telemetry flow only into appendMessage, never saveMemory/infer", () => {
    const code = stripComments(src("route"))
    expect(code).not.toMatch(/\bsaveMemory\s*\(/)
    expect(code).not.toMatch(/from\s+["']@\/lib\/chat\/infer["']/)
  })
})

describe("debug-log export action — reads via getChatThread/getMessages, never persists", () => {
  it("getThreadDebugLogAction body calls neither saveMemory nor inferMemoriesFromThread", () => {
    const code = stripComments(src("actions"))
    expect(code).toMatch(/getThreadDebugLogAction/)
    expect(code).toMatch(/getChatThread/)
    expect(code).toMatch(/getMessages/)
    // The actions module DOES import inferMemoriesFromThread for other actions
    // (inferFromThreadAction, inferIdleThreadsAction), so a file-level negative
    // would falsely fail. Scope the negative to the getThreadDebugLogAction body:
    // from its declaration to the next `export ` or end of file.
    const startIdx = code.indexOf("getThreadDebugLogAction")
    expect(startIdx, "getThreadDebugLogAction must be declared").toBeGreaterThan(-1)
    const rest = code.slice(startIdx)
    const nextExport = rest.indexOf("export ", 1)
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport)
    expect(body).not.toMatch(/\bsaveMemory\s*\(/)
    expect(body).not.toMatch(/\binferMemoriesFromThread\s*\(/)
  })
})

describe("delete-thread action — chat-only DB, no site writes / memory persist", () => {
  it("deleteThreadAction body references only chat DB functions and no site-write / memory-persist identifier", () => {
    const code = stripComments(src("actions"))
    expect(code).toMatch(/deleteThreadAction/)
    // The body must go through the chat-only guard + the chat DB deleters.
    expect(code).toMatch(/getChatThread/)
    expect(code).toMatch(/deleteMemoriesSourcedFromThread/)
    expect(code).toMatch(/\bdeleteThread\b/)
    // Scope the negatives to the deleteThreadAction body: from its declaration
    // to the next top-level `export ` (it is the last action, so to EOF).
    const startIdx = code.indexOf("deleteThreadAction")
    expect(startIdx, "deleteThreadAction must be declared").toBeGreaterThan(-1)
    const rest = code.slice(startIdx)
    const nextExport = rest.indexOf("export ", 1)
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport)
    for (const id of FORBIDDEN_IDENTIFIERS) {
      expect(body, `deleteThreadAction must not reference "${id}"`).not.toContain(id)
    }
    // Never persists memories or infers — delete only.
    expect(body).not.toMatch(/\bsaveMemory\s*\(/)
    expect(body).not.toMatch(/\binferMemoriesFromThread\s*\(/)
    expect(body).not.toMatch(/from\s+["']@\/lib\/chat\/infer["']/)
  })
})

describe("web_research audit capture — history-feedback + no-sentinel boundary (Q1)", () => {
  it("rowToMistral does not map web_research (no stale-evidence history feedback)", () => {
    const code = stripComments(src("messages"))
    // rowToMistral rebuilds Mistral history from chat_messages rows each turn.
    // It must map only role/content/tool_calls — never the web_research audit
    // column, or stale web evidence would re-enter the next turn's history.
    expect(code).not.toMatch(/web_research/i)
    expect(code).not.toMatch(/webResearch/i)
  })

  it("route never touches the snake_case web_research column directly (only via appendMessage webResearch param)", () => {
    const code = stripComments(src("route"))
    // The route must not read/write the DB column directly; it flows the audit
    // through appendMessage's webResearch param (lib/db/chat maps it to the
    // jsonb column) and the snapshot/build helpers. No snake_case references.
    expect(code).not.toMatch(/web_research/)
  })

  it("route never inserts a synthetic/sentinel tool row for web capture", () => {
    const code = stripComments(src("route"))
    // The only tool-row appendMessage is inside the real tool-call loop. The
    // advisor verdict ruled out a sentinel tool row (it would be fed back to
    // Mistral via rowToMistral, re-injecting stale evidence). Assert no
    // sentinel-name tool insert is introduced.
    expect(code).not.toMatch(/sentinel/i)
    expect(code).not.toMatch(/["']web_research["']/)
  })

  it("web_research audit never reaches saveMemory or infer", () => {
    const code = stripComments(src("route"))
    expect(code).not.toMatch(/\bsaveMemory\s*\(/)
    expect(code).not.toMatch(/from\s+["']@\/lib\/chat\/infer["']/)
  })

  it("tools.ts web_search path pushes the tool run only onto ctx.webAuditRuns (debug), never into saveMemory", () => {
    const code = stripComments(src("tools"))
    expect(code).toMatch(/webAuditRuns\.push/)
    expect(code).not.toMatch(/saveMemory[\s\S]{0,160}webAuditRuns/)
  })
})

describe("read_post path — read-only posts, no site-write / memory-persist", () => {
  it("post-read.ts imports only read post functions (no createPost/updatePost/deletePost)", () => {
    const raw = src("postRead")
    const code = stripComments(raw)
    // Imports the chat-path-allowable read layer @/lib/db/posts.
    expect(raw).toMatch(/from\s+["']@\/lib\/db\/posts["']/)
    // The write functions must never be referenced in real code. Check the
    // comment-stripped source so the header comment that names them to say
    // they are NOT imported doesn't false-positive.
    for (const id of FORBIDDEN_IDENTIFIERS) {
      expect(code, `post-read must not reference "${id}"`).not.toContain(id)
    }
    // Never persists memories or infers; never imports the service client
    // directly (it goes through @/lib/db/posts, the read layer).
    expect(code).not.toMatch(/\bsaveMemory\s*\(/)
    expect(code).not.toMatch(/\binferMemoriesFromThread\s*\(/)
    expect(code).not.toMatch(/from\s+["']@\/lib\/chat\/infer["']/)
    expect(raw).not.toMatch(/from\s+["']@\/lib\/supabase\/server["']/)
    expect(raw).not.toMatch(/from\s+["']@\/lib\/supabase\/storage["']/)
  })

  it("read_post tool path in tools.ts delegates to readPostForTool (no site-write)", () => {
    const code = stripComments(src("tools"))
    // The read_post case must delegate to readPostForTool.
    expect(code).toMatch(/case "read_post"/)
    expect(code).toMatch(/readPostForTool/)
    // Scope the negatives to the read_post case body (from its case label to
    // the next `case `).
    const startIdx = code.indexOf('case "read_post"')
    expect(startIdx).toBeGreaterThan(-1)
    const rest = code.slice(startIdx)
    const nextCase = rest.indexOf("case ", 1)
    const body = nextCase === -1 ? rest : rest.slice(0, nextCase)
    for (const id of FORBIDDEN_IDENTIFIERS) {
      expect(body, `read_post body must not reference "${id}"`).not.toContain(id)
    }
    expect(body).not.toMatch(/\bsaveMemory\s*\(/)
    expect(body).not.toMatch(/\binferMemoriesFromThread\s*\(/)
  })
})

describe("debug-log MD renderer — pure, no persistence, no raw HTML (round 3)", () => {
  // The MD renderer (incl. the round-3 source-snippet rendering) is pure: it
  // draws only from the already-captured WebResearchSourceAudit.snippet field,
  // imports no web/search/persistence module, and emits plain text — never
  // dangerouslySetInnerHTML (it is server-side Markdown string assembly, not
  // JSX). Snippets are read-only debug material; they never reach saveMemory or
  // infer and are not fed back into history (rowToMistral does not map
  // web_research).
  it("debug-log imports no tavily / mistral / site-write / infer module", () => {
    const raw = src("debugLog")
    expect(raw).not.toMatch(/from\s+["']@\/lib\/chat\/tavily-search["']/)
    expect(raw).not.toMatch(/from\s+["']@\/lib\/chat\/mistral["']/)
    expect(raw).not.toMatch(/from\s+["']@\/lib\/chat\/infer["']/)
    for (const re of FORBIDDEN_IMPORTS) {
      expect(raw, `debug-log must not match ${re}`).not.toMatch(re)
    }
    for (const id of FORBIDDEN_IDENTIFIERS) {
      expect(stripComments(raw), `debug-log must not reference "${id}"`).not.toContain(id)
    }
  })

  it("debug-log never references saveMemory / inferMemoriesFromThread / dangerouslySetInnerHTML", () => {
    const code = stripComments(src("debugLog"))
    expect(code).not.toMatch(/\bsaveMemory\s*\(/)
    expect(code).not.toMatch(/\binferMemoriesFromThread\s*\(/)
    expect(code).not.toMatch(/dangerouslySetInnerHTML/)
  })
})