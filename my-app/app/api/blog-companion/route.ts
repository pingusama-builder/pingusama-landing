import { getCurrentUser, isAdmin } from "@/lib/auth"
import {
  getCompanionThread,
  getOrCreateCompanionThread,
  appendMessage,
  getMessages,
  consumeOneTurnOverride,
  recallMemories,
  type MessageRole,
  type ChatMessageRow,
} from "@/lib/db/chat"
import { buildWritingContext } from "@/lib/chat/writing-context"
import { buildCompanionPrompt } from "@/lib/chat/companion-prompt"
import {
  companionToolsFor,
  executeCompanionToolCall,
  type CompanionDraft,
  type CompanionToolResult,
} from "@/lib/chat/companion-tools"
import {
  MODEL_TIERS,
  DEFAULT_TIER,
  type ModelTier,
  type ModelPreference,
} from "@/lib/chat/models"
import { mistralStream, type MistralMessage, type MistralToolCall } from "@/lib/chat/mistral"
import { detectPseudoToolCall, evaluateTerminalExpectation } from "@/lib/chat/fiction-terminal"
import type { DraftSnapshot } from "@/lib/blog/proposals"

// Advisor phase B10 Q1 — raised 60 → 240. Vercel Hobby now allows 300s under
// Fluid Compute; 60 was self-imposed. The observed full-review max was 202s,
// so 240 is a proportionate ceiling (not 300). This is a route-level Next.js
// export (applies to all scopes; narrow scopes finish in ~5s and never reach
// it). Keep the route export; vercel.ts is not needed (verdict Q1).
export const maxDuration = 240
export const runtime = "nodejs"

// SECURITY: this route imports ONLY the chat data layer (read + constrained
// write + thread helpers), buildWritingContext (read), mistralStream, the model
// plumbing, and the companion tool dispatcher. It does NOT import
// savePostAction / createPost / updatePost / deletePost, storage/bench/shelf
// write modules, or the generic lib/supabase/server service client. The
// dispatch allowlist (companion-tools) is the security boundary; propose_edit
// is pure. The publish path is already XSS-sanitized (parseMarkdown) — verified
// by tests in Task 13, not rebuilt here.

const MAX_TURNS = 3
const MAX_MEMORY_WRITES = 3
const MAX_PROPOSALS_PER_TURN = 8
const MAX_DRAFT_CHARS = 50_000
const MAX_MESSAGE_CHARS = 4000
// Per-turn output cap. Default 1200 / 1200 (final). The per-turn cap was
// raised 800→1200 per advisor phase B8 Q3 (the post-Patch-A full review still
// truncated mid-Finding 3 at 800; 1200 is a Mistral-specific operational test,
// not a general answer — do not raise again until a 1200-token trace completes
// under the chosen product protocol). Override via env for a reasoning
// substrate (e.g. Ollama GLM 5.2) whose thinking tokens count against
// max_tokens (advisor phase B8 Q7 substrate check).
const MAX_TOKENS = Number(process.env.COMPANION_MAX_TOKENS) || 1200
const MAX_TOKENS_FINAL = Number(process.env.COMPANION_MAX_TOKENS_FINAL) || 1200

type CompanionScope = "title" | "sentence" | "opening" | "section" | "full"

type ReviewMode = "auto" | "prose" | "fiction" | "line-edit"
const REVIEW_MODES: ReviewMode[] = ["auto", "prose", "fiction", "line-edit"]

/** Scope → tier (spec §5.4). title/sentence → small; opening/section → medium; full → large; none → default(medium). */
function scopeToTier(scope: CompanionScope | undefined): ModelTier {
  if (scope === "title" || scope === "sentence") return "small"
  if (scope === "full") return "large"
  if (scope === "opening" || scope === "section") return "medium"
  return DEFAULT_TIER
}

/** Normalize a proposal for duplicate detection within one response.
 * A streaming model can emit the same propose_edit twice; dedupe cards by
 * normalized (field, original, replacement) so the author sees one card. */
function proposalDedupeKey(p: { field?: string; original?: string; replacement?: string }): string {
  const norm = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ")
  return `${norm(p.field)}|${norm(p.original)}|${norm(p.replacement)}`
}

/** Parse propose_edit raw args → a normalized (field, original, replacement) key,
 * or null if the args are unparseable (in which case we do not dedupe — let the
 * tool dispatcher surface the parse error itself). Used for the PRE-execution
 * dedupe (Remedy A): collapses identical retries whether they would succeed or
 * fail (e.g. a model hammering a misquoted anchor → "found 0 × N" becomes one
 * error + N−1 skips). A corrected retry changes `original` → different key →
 * still allowed. */
function proposeEditArgsDedupeKey(rawArgs: string): string | null {
  try {
    const a = JSON.parse(rawArgs)
    if (typeof a !== "object" || a === null) return null
    return proposalDedupeKey({ field: a.field, original: a.original, replacement: a.replacement })
  } catch {
    return null
  }
}

// Advisor phase B10 Q4 — stop-rule instrumentation. One aggregate object per
// run, emitted as an SSE event (admin Diagnostics) + a structured console log
// (for log-based stop-rule evaluation post-deploy). The fields map 1:1 to the
// verdict's stop rules: native terminal rate (terminal_called_any), bypass
// rate (bypass_any), cap-exhaustion/timeout rate (finish_reasons), latency
// (elapsed_ms), reasoning volume (total_reasoning_chars). See VERDICT-phaseB10
// Q4 "Stop rules".
interface RunSummary {
  scope: string | null
  tier: ModelTier
  model: string
  response_model: string
  turns: number
  terminal_called_any: boolean
  bypass_any: boolean
  finish_reasons: (string | null)[]
  total_reasoning_chars: number
  total_text_chars: number
  elapsed_ms: number
  had_transport_error: boolean
}
function buildRunSummary(args: {
  scope: CompanionScope | undefined
  tier: ModelTier
  modelId: string
  responseModel: string
  turns: number
  terminalCalledAny: boolean
  bypassAny: boolean
  finishReasons: (string | null)[]
  totalReasoningChars: number
  totalTextChars: number
  startedAt: number
  hadTransportError: boolean
}): RunSummary {
  return {
    scope: args.scope ?? null,
    tier: args.tier,
    model: args.modelId,
    response_model: args.responseModel,
    turns: args.turns,
    terminal_called_any: args.terminalCalledAny,
    bypass_any: args.bypassAny,
    finish_reasons: args.finishReasons,
    total_reasoning_chars: args.totalReasoningChars,
    total_text_chars: args.totalTextChars,
    elapsed_ms: Date.now() - args.startedAt,
    had_transport_error: args.hadTransportError,
  }
}

// ── Fiction preamble cap (advisor phase B8 structured-terminal) ──────────
// In fiction mode the model may emit a short companion-voice preamble before
// the submit_fiction_review call. Cap the FORWARDED content at 2 sentences
// (mechanical post-output guard — a prompt "be brief" clause would be
// probabilistic on the substrate). The assessment itself lives inside the tool
// call, so the preamble cannot become an edit-narration slot. Non-fiction mode
// forwards content unchanged. Robust to streaming: forward only the new slice
// of the 2-sentence prefix of the accumulated preamble; once 2 sentences have
// passed, lock and drop further content deltas.
function isSentenceEnder(s: string, k: number): boolean {
  return /[.!?]/.test(s[k]) && (k + 1 >= s.length || /\s/.test(s[k + 1]))
}
function firstTwoSentences(s: string): string {
  let count = 0
  for (let k = 0; k < s.length; k++) {
    if (isSentenceEnder(s, k)) {
      count += 1
      if (count === 2) return s.slice(0, k + 1)
    }
  }
  return s // fewer than 2 sentences so far → return all
}
function sentenceCount(s: string): number {
  let count = 0
  for (let k = 0; k < s.length; k++) if (isSentenceEnder(s, k)) count += 1
  return count
}
function fictionPreambleForwarder(send: (o: Record<string, unknown>) => void) {
  let acc = ""
  let sentChars = 0
  let locked = false
  return (delta: string) => {
    if (locked) return
    acc += delta
    const firstTwo = firstTwoSentences(acc)
    if (firstTwo.length > sentChars) {
      send({ type: "content", delta: firstTwo.slice(sentChars) })
      sentChars = firstTwo.length
    }
    if (sentenceCount(acc) >= 2) locked = true
  }
}

function rowToMistral(row: ChatMessageRow): MistralMessage | null {
  if (row.role === "user") return { role: "user", content: row.content ?? "" }
  if (row.role === "assistant") {
    const msg: MistralMessage = {
      role: "assistant",
      content: row.content && row.content.length > 0 ? row.content : null,
    }
    const tc = row.tool_calls as MistralToolCall[] | null
    if (tc && tc.length > 0) msg.tool_calls = tc
    return msg
  }
  if (row.role === "tool") {
    const meta = row.tool_calls as { tool_call_id?: string } | null
    return {
      role: "tool",
      content: row.content ?? "",
      tool_call_id: meta?.tool_call_id ?? "",
    }
  }
  return null
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return true // absent → not a cross-origin browser POST; admin gate still applies
  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  // ── Admin gate (the route is NOT under /admin/, so middleware doesn't cover it) ──
  const user = await getCurrentUser()
  if (!user || !isAdmin(user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  // ── Origin/CSRF check (raw route handlers don't get Next.js automatic CSRF) ──
  if (!sameOrigin(request)) {
    return Response.json({ error: "Cross-origin not allowed" }, { status: 403 })
  }

  let body: {
    threadId?: string
    message?: string
    subjectType?: string
    subjectKey?: string
    draft?: DraftSnapshot
    scope?: CompanionScope
    reviewMode?: ReviewMode
    modelPreference?: ModelPreference
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const message = (body.message ?? "").trim()
  if (!message) {
    return Response.json({ error: "Missing message" }, { status: 400 })
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return Response.json({ error: `Message too long (≤${MAX_MESSAGE_CHARS} chars)` }, { status: 413 })
  }

  // ── Subject (server-authoritative thread key) ──
  const subjectType = body.subjectType
  const subjectKey = body.subjectKey
  if (subjectType !== "post" && subjectType !== "draft") {
    return Response.json({ error: "Invalid subjectType" }, { status: 400 })
  }
  if (!subjectKey || subjectKey.length > 200) {
    return Response.json({ error: "Invalid subjectKey" }, { status: 400 })
  }

  // ── Draft (ephemeral context — NOT persisted) ──
  const draft = body.draft
  if (!draft || typeof draft !== "object") {
    return Response.json({ error: "Missing draft" }, { status: 400 })
  }
  const draftLen =
    (draft.content_markdown?.length ?? 0) +
    (draft.title?.length ?? 0) +
    (draft.excerpt?.length ?? 0) +
    (draft.meta_description?.length ?? 0)
  if (draftLen > MAX_DRAFT_CHARS) {
    return Response.json({ error: `Draft too large (≤${MAX_DRAFT_CHARS} chars)` }, { status: 413 })
  }
  const companionDraft: CompanionDraft = {
    content_markdown: draft.content_markdown ?? "",
    title: draft.title ?? "",
    excerpt: draft.excerpt ?? "",
    meta_description: draft.meta_description ?? "",
  }

  // ── Thread resolution + verification (spec §5.3) ──
  let threadId = body.threadId
  let modelPreference: ModelPreference = "auto"
  if (threadId) {
    // Subsequent turn: verify the supplied threadId is a companion thread for
    // THIS subject. getCompanionThread returns null for chat threads, subject
    // mismatches, or nonexistent ids → 400. The client cannot repurpose threads.
    const t = await getCompanionThread(threadId, { subjectType, subjectKey })
    if (!t) {
      return Response.json({ error: "Thread not available for this subject" }, { status: 400 })
    }
    modelPreference = t.model_preference ?? "auto"
  } else {
    // First turn: resolve-or-create by stable subject.
    const t = await getOrCreateCompanionThread({
      subjectType: subjectType as "post" | "draft",
      subjectKey,
    })
    threadId = t.id
    modelPreference = t.model_preference ?? "auto"
  }

  // ── Model resolution: override → pinned (≠auto) → scope → default ──
  const scope = body.scope
  const reviewMode = body.reviewMode
  if (reviewMode !== undefined && !REVIEW_MODES.includes(reviewMode)) {
    return Response.json({ error: "Invalid reviewMode" }, { status: 400 })
  }
  const override = await consumeOneTurnOverride(threadId)
  let tier: ModelTier
  let reason: string
  if (override) {
    tier = override
    reason = `override (${override})`
  } else if (modelPreference && modelPreference !== "auto") {
    tier = modelPreference
    reason = `pinned (${modelPreference})`
  } else {
    tier = scopeToTier(scope)
    reason = `scope → ${tier} (${scope ?? "free-form"})`
  }
  const modelId = MODEL_TIERS[tier] ?? MODEL_TIERS[DEFAULT_TIER]

  // ── Persist the REQUEST only (not the draft) (spec §5.5) ──
  const scopeNote = scope ? ` [scope: ${scope}]` : ""
  const modeNote = reviewMode && reviewMode !== "auto" ? ` [mode: ${reviewMode}]` : ""
  await appendMessage({ threadId, role: "user", content: message + scopeNote + modeNote })

  // ── Build prompt context (once) ──
  const [writingContext, memories, historyRows] = await Promise.all([
    buildWritingContext(),
    recallMemories({ limit: 40, includeSite: false }),
    getMessages(threadId),
  ])
  // Blind-isolation memory condition (advisor phase B8 cross-draft matrix —
  // the Prof. Golden blind-isolation runs in eval/substrate-matrix.md): when
  // COMPANION_BLIND_REVIEW is set, suppress ALL recalled memories so the review
  // assesses the submitted text only (no profile/work/author/style bias). The
  // site memory store is global (not per-user), so a fresh test admin user
  // would still recall it — suppression must be explicit. Dormant when unset;
  // the production path recalls memories exactly as before. This is a
  // mechanical input guard (the doctrine), not a prompt clause.
  const recalledMemories = process.env.COMPANION_BLIND_REVIEW ? [] : memories
  const systemPrompt = buildCompanionPrompt({
    writingContext,
    memories: recalledMemories,
    draft: companionDraft,
    scope,
    reviewMode,
  })

  const history = historyRows.map(rowToMistral).filter((m): m is MistralMessage => m !== null)
  const mistralMessages: MistralMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(0, -1),
    { role: "user", content: message + scopeNote + modeNote },
  ]

  // ── SSE stream + agent loop (MAX_TURNS=3) ──
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      let emitted = false // content or a proposal was sent → partial-aware error
      // ── Advisor phase B10 — cross-run accumulators ───────────────────
      // terminal_expected (Q5) + run_summary (Q4) aggregate across all turns
      // in this run. terminalCalledAny: any submit_fiction_review this run.
      // bypassAny: any prose pseudo-tool bypass this run (the protocol_bypass
      // notice already covered that turn). finishReasons: per-turn finishes
      // (the last one drives the Q5 trigger; the list feeds the stop rules).
      // Declared outside `try` so the catch block can set hadTransportError
      // (same scoping pattern as `emitted` above).
      let terminalCalledAny = false
      let bypassAny = false
      const finishReasons: (string | null)[] = []
      let totalReasoningChars = 0
      let totalTextChars = 0
      const startedAt = Date.now()
      let hadTransportError = false
      let lastResponseModel = ""
      let turns = 0
      try {
        send({ type: "thread", threadId })
        send({ type: "model", tier, modelId, reason })

        const toolCtx = {
          sourceThreadId: threadId,
          memoryWrites: 0,
          maxMemoryWrites: MAX_MEMORY_WRITES,
        }
        let proposalsThisTurn = 0
        const emittedProposalKeys = new Set<string>()
        const attemptedProposalArgKeys = new Set<string>()
        // Fiction mode: the structured terminal (submit_fiction_review) is the
        // only edit path; the prose preamble is capped at 2 sentences. Other
        // modes keep the blog tool set + uncapped content.
        const tools = companionToolsFor(reviewMode)
        // Mechanical correctness guard (advisor phase B8 post-deploy): only
        // EXECUTE + persist tool calls for tools that were actually OFFERED to
        // the model this turn. A non-reasoning / reasoning substrate can emit a
        // tool call for a function not in the offered set (e.g. hallucinating
        // `propose_edit` in fiction mode, where it is not offered). If such a
        // call were executed it would produce a proposal from a path the mode
        // disallows, and if it were pushed into history the next turn's request
        // would carry a tool_call referencing an unoffered function → Mistral
        // 3230 "Not the same number of function calls and responses". The
        // dispatcher allowlist (COMPANION_ALLOWED) is the SECURITY boundary;
        // this offered-set filter is the CORRECTNESS boundary. Stripped calls
        // are surfaced as a tool event (transparency) but never enter history.
        const offeredToolNames = new Set(tools.map((t) => t.function.name))
        const forwardContent =
          reviewMode === "fiction"
            ? fictionPreambleForwarder(send)
            : (delta: string) => send({ type: "content", delta })
        while (turns < MAX_TURNS) {
          turns += 1
          const isFinalGuess = turns === MAX_TURNS

          const acc = await mistralStream({
            messages: mistralMessages,
            tools,
            model: modelId,
            maxTokens: isFinalGuess ? MAX_TOKENS_FINAL : MAX_TOKENS,
            signal: request.signal,
            onContent: (delta) => {
              emitted = true
              forwardContent(delta)
            },
            onReasoning: (delta) => {
              send({ type: "reasoning", delta })
            },
          })

          finishReasons.push(acc.finish_reason ?? null)
          totalReasoningChars += acc.reasoning_chars ?? 0
          totalTextChars += acc.text_chars ?? 0
          if (acc.response_model) lastResponseModel = acc.response_model

          // Filter to offered tools (see offeredToolNames comment above).
          const calls = acc.tool_calls.filter((c) => offeredToolNames.has(c.function.name))
          const stripped = acc.tool_calls.filter((c) => !offeredToolNames.has(c.function.name))

          await appendMessage({
            threadId,
            role: "assistant" as MessageRole,
            content: acc.content,
            toolCalls: calls.length > 0 ? calls : undefined,
            model: modelId,
          })

          // Surface hallucinated calls for tools not offered this turn (e.g.
          // propose_edit in fiction mode) as a tool event so the author sees
          // why no edit landed — but DO NOT execute or persist them to history
          // (that would risk a Mistral 3230 on the next turn).
          for (const s of stripped) {
            send({
              type: "tool",
              name: s.function.name,
              status: "done",
              result: `Skipped: ${s.function.name} is not offered in this mode — use the offered review tool.`,
            })
          }

          // Advisor phase B9 Q6 — non-mutating pseudo-tool bypass detector. In
          // fiction mode the structured terminal (submit_fiction_review) is the
          // only edit path; if the model narrates a tool call as prose
          // (propose_edit:{...} / submit_fiction_review:{...} / fenced JSON tool
          // payload) AND did NOT actually call submit_fiction_review, surface a
          // neutral protocol-status notice. Do NOT strip, auto-convert, or
          // execute the payload — only observe (no laundering of prose into an
          // action). The notice prevents a misleading empty UI state and makes
          // the failure a crisp metric for the A/B test.
          if (reviewMode === "fiction") {
            const bypass = detectPseudoToolCall(acc.content)
            const terminalCalled = calls.some((c) => c.function.name === "submit_fiction_review")
            if (terminalCalled) terminalCalledAny = true
            if (bypass && !terminalCalled) {
              bypassAny = true
              send({
                type: "protocol_bypass",
                tool: bypass.tool,
                notice: "The review contained an unsubmitted edit payload; no edit proposal was created.",
              })
              // Server-side log: model, scope, tier, request id, offered tools
              // (the verdict's Q6 logging contract — the crisp metric).
              console.warn(
                "[terminal_protocol_bypass]",
                JSON.stringify({
                  tool: bypass.tool,
                  threadId,
                  scope: scope ?? null,
                  tier,
                  model: modelId,
                  tools_offered: tools.map((t) => t.function.name),
                })
              )
            }
          }

          // Advisor phase B9 Q1 — per-turn telemetry. response_model is the
          // DECISIVE confound field (the configured alias is NOT proof of which
          // model answered — the alias could resolve unexpectedly, an SDK/proxy
          // could transform the request, or the parser could misclassify).
          // Emitted in fiction mode (the substrate-experiment surface) or when
          // COMPANION_TELEMETRY is set; dormant otherwise to keep prose/line-edit
          // clean. char proxies stand in for token counts (no tokenizer).
          if (reviewMode === "fiction" || process.env.COMPANION_TELEMETRY) {
            send({
              type: "telemetry",
              turn: turns,
              scope: scope ?? null,
              tier,
              requested_model: modelId,
              response_model: acc.response_model ?? "",
              reasoning_effort_sent: acc.reasoning_effort_sent ?? null,
              content_chunk_types: acc.content_chunk_types ?? [],
              reasoning_chars: acc.reasoning_chars ?? 0,
              text_chars: acc.text_chars ?? 0,
              finish_reason: acc.finish_reason ?? null,
              tools_offered: tools.map((t) => t.function.name),
              tool_calls_received: calls.map((c) => c.function.name),
              fiction_terminal_called: calls.some(
                (c) => c.function.name === "submit_fiction_review"
              ),
            })
          }

          if (calls.length === 0) break

          mistralMessages.push({
            role: "assistant",
            content: acc.content || null,
            tool_calls: calls,
          })

          for (const call of calls) {
            send({ type: "tool", name: call.function.name, status: "running" })

            // Remedy A (advisor phase-B3): dedupe identical propose_edit attempts
            // BEFORE execution. Catches repeated calls whether they would succeed
            // or fail (e.g. a model hammering a misquoted anchor → "found 0 × N"
            // collapses to one error + N−1 duplicate-skips). A corrected retry
            // changes `original` → a different key → still allowed. Non-propose_edit
            // tools and unparseable args skip this guard (argsKey === null).
            const argsKey =
              call.function.name === "propose_edit"
                ? proposeEditArgsDedupeKey(call.function.arguments)
                : null
            let result: CompanionToolResult
            if (argsKey !== null && attemptedProposalArgKeys.has(argsKey)) {
              result = {
                content:
                  "Duplicate propose_edit skipped: this exact field, anchor, and replacement was already attempted in this response.",
                memoryWrite: false,
              }
            } else {
              if (argsKey !== null) attemptedProposalArgKeys.add(argsKey)
              result = await executeCompanionToolCall(
                call.function.name,
                call.function.arguments,
                toolCtx,
                companionDraft
              )
            }
            send({
              type: "tool",
              name: call.function.name,
              status: "done",
              result: result.content,
            })
            if (result.proposal) {
              // Post-match dedupe: catches two proposals that diverged in raw args
              // but normalize to the same (field, original, replacement) after
              // proposal construction. Distinct from the pre-execution guard above.
              const key = proposalDedupeKey(result.proposal)
              if (emittedProposalKeys.has(key)) {
                send({
                  type: "tool",
                  name: call.function.name,
                  status: "done",
                  result: "Duplicate proposal dropped (same field/original/replacement already emitted).",
                })
              } else if (proposalsThisTurn < MAX_PROPOSALS_PER_TURN) {
                emittedProposalKeys.add(key)
                proposalsThisTurn += 1
                emitted = true
                send({ type: "proposal", ...result.proposal })
              } else {
                send({
                  type: "tool",
                  name: call.function.name,
                  status: "done",
                  result: `Proposal dropped: per-turn cap (${MAX_PROPOSALS_PER_TURN}) reached.`,
                })
              }
            }
            // submit_fiction_review returns multiple proposals (one per
            // finding-with-edit) + a fictionReview payload. Emit each proposal
            // through the same dedupe + per-turn cap as a single propose_edit,
            // then the one fiction_review event for the UI.
            if (result.proposals && result.proposals.length > 0) {
              for (const p of result.proposals) {
                const key = proposalDedupeKey(p)
                if (emittedProposalKeys.has(key)) continue
                if (proposalsThisTurn >= MAX_PROPOSALS_PER_TURN) {
                  send({
                    type: "tool",
                    name: call.function.name,
                    status: "done",
                    result: `Proposal dropped: per-turn cap (${MAX_PROPOSALS_PER_TURN}) reached.`,
                  })
                  break
                }
                emittedProposalKeys.add(key)
                proposalsThisTurn += 1
                emitted = true
                send({ type: "proposal", ...p })
              }
            }
            if (result.fictionReview) {
              emitted = true
              send({ type: "fiction_review", ...result.fictionReview })
            }
            await appendMessage({
              threadId,
              role: "tool" as MessageRole,
              content: result.content,
              toolCalls: { tool_call_id: call.id, name: call.function.name },
            })
            mistralMessages.push({
              role: "tool",
              content: result.content,
              tool_call_id: call.id,
            })
          }
        }

        // Advisor phase B10 Q5 — terminal-expectation notice. Non-mutating:
        // observe + notice only (no strip/convert/execute/retry). Fires when a
        // fiction run ended normally (last finish=stop) with no submit_fiction_
        // review call and no prose bypass — the "clean NO CHANGE. prose, no
        // terminal" skip mode. hadTransportError is false on this clean path
        // (a thrown error jumps to catch before reaching here).
        if (reviewMode === "fiction") {
          const lastFinish = finishReasons[finishReasons.length - 1] ?? null
          if (
            evaluateTerminalExpectation({
              finishReason: lastFinish,
              terminalCalledAny,
              bypassAny,
              hadTransportError,
            })
          ) {
            send({
              type: "terminal_expected",
              notice:
                "Review completed without the required fiction terminal submission; no validated findings or edit cards were created.",
            })
          }
        }

        // Advisor phase B10 Q4 — run_summary (stop-rule instrumentation). Same
        // gate as per-turn telemetry: fiction mode OR COMPANION_TELEMETRY, so
        // prose/line-edit stay clean. The structured log is fiction-only (the
        // server-side stop-rule feed); the SSE event is admin Diagnostics.
        if (reviewMode === "fiction" || process.env.COMPANION_TELEMETRY) {
          const summary = buildRunSummary({
            scope,
            tier,
            modelId,
            responseModel: lastResponseModel,
            turns,
            terminalCalledAny,
            bypassAny,
            finishReasons,
            totalReasoningChars,
            totalTextChars,
            startedAt,
            hadTransportError,
          })
          send({ type: "run_summary", ...summary })
        }
        if (reviewMode === "fiction") {
          // Best-effort structured log; never let logging break the stream.
          try {
            console.info(
              "[companion_run_summary]",
              JSON.stringify({
                scope: scope ?? null,
                tier,
                model: modelId,
                response_model: lastResponseModel,
                turns,
                terminal_called_any: terminalCalledAny,
                bypass_any: bypassAny,
                finish_reasons: finishReasons,
                total_reasoning_chars: totalReasoningChars,
                total_text_chars: totalTextChars,
                elapsed_ms: Date.now() - startedAt,
                had_transport_error: hadTransportError,
              })
            )
          } catch {
            /* ignore log failure */
          }
        }

        send({ type: "done", threadId })
      } catch (err) {
        hadTransportError = true
        if (reviewMode === "fiction" || process.env.COMPANION_TELEMETRY) {
          try {
            send({
              type: "run_summary",
              ...buildRunSummary({
                scope,
                tier,
                modelId,
                responseModel: lastResponseModel,
                turns,
                terminalCalledAny,
                bypassAny,
                finishReasons,
                totalReasoningChars,
                totalTextChars,
                startedAt,
                hadTransportError: true,
              }),
            })
          } catch {
            /* best-effort: don't let summary emission break the error path */
          }
        }
        // Best-effort structured log on the error path too (I-1): the stop-rule feed must see had_transport_error: true.
        if (reviewMode === "fiction") {
          try {
            console.info(
              "[companion_run_summary]",
              JSON.stringify({
                scope: scope ?? null,
                tier,
                model: modelId,
                response_model: lastResponseModel,
                turns,
                terminal_called_any: terminalCalledAny,
                bypass_any: bypassAny,
                finish_reasons: finishReasons,
                total_reasoning_chars: totalReasoningChars,
                total_text_chars: totalTextChars,
                elapsed_ms: Date.now() - startedAt,
                had_transport_error: hadTransportError,
              })
            )
          } catch {
            /* ignore log failure */
          }
        }
        const msg = err instanceof Error ? err.message : "Companion failed"
        send({ type: "error", message: msg, partial: emitted })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-vercel-no-loop": "1",
    },
  })
}