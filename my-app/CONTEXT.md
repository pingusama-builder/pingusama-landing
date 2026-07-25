# CONTEXT — Pingusama's Tinkering (chat companion domain glossary)

A project-level glossary for the chat companion. Architecture reviews and ADRs
read this for domain nouns; the canon memory (`pingusama-tinkering-project.md`)
holds the full session-by-session history and is not repo-resident.

## chat turn

**chat turn** — one user message through the chat companion, end to end:
resume resolution → external-verification suggestion pause → model resolution →
web research pipeline → agent loop → persistence. The unit the chat route
hands off to `runChatTurn` in `lib/chat/chat-turn.ts`. The route is a thin
HTTP/SSE translator around it; the turn's invariants (pause-before-synthesize,
idempotent resume, stay-gates-`web_search`) live inside the module, testable
through its typed event stream + discriminated result.

## pending source choice

**pending source choice** — a turn-scoped row in `pending_source_choices`
written when the external-verification detector *proposes* (never auto-searches).
The suggestion turn PAUSES (no synthesis, no assistant row, no model call) and
returns the pending choice to the client. The user's approve/decline click is a
second POST that loads + resolves the row, then synthesizes: approve ("search")
→ the audited web pipeline forced on; decline ("stay") → site-first synthesis
with a stay-scope label. Lives in its own table so it never re-enters Mistral
history (rowToMistral rebuilds from `chat_messages` only) and never becomes
durable memory.

## web research pipeline

**web research pipeline** — the code-driven depth+breadth search run on an
authorized web turn: query-rewrite/expand → parallel Tavily searches →
merge/rank → /extract top sources → bounded, guarded evidence injected into
this turn's system prompt only. Web text is never persisted to memory and never
written to site content. The pipeline pushes a `pipeline` audit run; a later
`web_search` tool follow-up pushes a `tool` audit run.

## audited pipeline

**audited pipeline** — the web-research audit capture: each assistant row
snapshots the audit runs accumulated so far (capture-by-model-call-visibility),
deep-copied so a later tool run can't mutate an already-persisted record.
Read-only debug material — never reaches `save_memory`/`infer`, never fed back
to Mistral (rowToMistral maps only role/content/tool_calls; the `web_research`
jsonb column is invisible to it).

## tool surface

**tool surface** — the tools offered to the model on a turn. The chat surface
(`CHAT_TOOLS` in `lib/chat/tools.ts`) and the companion surface
(`COMPANION_TOOLS` in `lib/chat/companion-tools.ts`) are distinct; the
companion allowlist is the security boundary, enforced by `executeToolCall`
refusing unknown names. `web_search` is mechanically gated on `ctx.webTouched`
(false on a stay-decline / `/noweb` turn) so a model-emitted follow-up can't fire
a real Tavily call after the user chose "Stay on this site".

## Architecture vocabulary

The deep/shallow module vocabulary (module, interface, implementation, depth,
seam, adapter, leverage, locality) comes from the `codebase-design` skill. Use
those terms exactly in architecture notes — don't drift into "component",
"service", "boundary", "layer", "wrapper".

## Deferred deepening candidates (backlog)

From the 2026-07-25 architecture review:

- **Candidate 2** — split `lib/chat/web-trigger.ts` at the round-7 seam: the
  live `detectExternalVerificationNeed` detector from the stranded pre-pivot
  classifier (`decideWebEnabled` / `classifyWebNeed`), kept alive only by tests
  + the `classifier-variance` live harness. Split is safe; deletion needs the
  harness retired first.
- **Candidate 3** — split the web-audit/gate out of `lib/chat/tools.ts` (tool
  defs + dispatcher + web-audit/gate are three modules stapled; the web→memory
  gate calls back up into `mistral.mistralTurn`). One caller (the chat-turn
  module) is a hypothetical seam today; revisit when a second caller appears.
- **Candidate 5** — mend the `companion-tools` ↔ `tools` seam (security
  boundary straddles two files; arg-parse helpers duplicated) and dedup the
  model-resolution cascade (`models.resolveModel` exists but the turn uses an
  inline hybrid cascade — `resolveModel` is sync-only/pure-heuristic; dedup
  requires making it async + hybrid-aware + web-aware, a real redesign).