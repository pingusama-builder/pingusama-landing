import { getCurrentUser, isAdmin } from "@/lib/auth"
import {
  createThread,
  getThread,
  appendMessage,
  getMessages,
  consumeOneTurnOverride,
  type MessageRole,
  type DebugTelemetry,
  type WebResearchAudit,
  type WebResearchRun,
} from "@/lib/db/chat"
import { recallMemories } from "@/lib/db/chat"
import { buildSiteContext } from "@/lib/chat/awareness"
import { buildSystemPrompt } from "@/lib/chat/prompt"
import { CHAT_TOOLS, executeToolCall, type ToolContext } from "@/lib/chat/tools"
import {
  searchWeb,
  mergeWebResearch,
  rankSources,
  extractPages,
  formatWebEvidenceGuarded,
  subjectInSources,
  type WebResearch,
  type WebSource,
  type ExtractedPage,
} from "@/lib/chat/tavily-search"
import { rewriteSearchQueries } from "@/lib/chat/query-rewrite"
import { decideWebEnabled, type WebDecision } from "@/lib/chat/web-trigger"
import { detectPostReviewIntent, loadNewestPostForPrompt } from "@/lib/chat/post-read"
import { snapshotWebResearch, buildPipelineAuditRun } from "@/lib/chat/tools"
import {
  classifyDifficultyHybrid,
  bandToTier,
  MODEL_TIERS,
  DEFAULT_TIER,
  type ModelTier,
  type ModelPreference,
} from "@/lib/chat/models"
import {
  mistralStream,
  reasoningEffortForModel,
  type MistralMessage,
} from "@/lib/chat/mistral"
import { rowToMistral } from "@/lib/chat/messages"

export const maxDuration = 60
export const runtime = "nodejs"

const MAX_TURNS = 6
const MAX_MEMORY_WRITES = 3

// Base (non-web) chat caps. Web-synthesis turns use the co-adaptive budgets
// below. Raised from 600/1200 so non-web answers have room to be useful.
const BASE_MAX_TOKENS = 2000
const BASE_FINAL_MAX_TOKENS = 4000

// Web-synthesis budgets co-adapt to evidence load (guard/empty → low, snippets
// → medium, full pages → high). Below the reasoning-effort selection.
const WEB_BUDGET_GUARD = 1500
const WEB_BUDGET_SNIPPETS = 4000
const WEB_BUDGET_PAGES = 8000

// Soft deadline guarding Vercel Hobby's 60s maxDuration. The signal propagates
// to mistralStream; on abort the partial answer is persisted (graceful degrade).
const SOFT_DEADLINE_MS = 55_000

// Snapshot the per-turn web-research audit for persistence on an assistant row
// (capture-by-model-call-visibility: each assistant call sees the runs
// accumulated so far). Deep-copies the runs so a later tool run pushed onto the
// shared array can't mutate an already-persisted record. Returns null when no
// web research ran this turn (non-web assistant rows get a null column).
function snapshotWebResearchAudit(runs: WebResearchRun[]): WebResearchAudit | null {
  if (runs.length === 0) return null
  return {
    schemaVersion: 1,
    availableToAssistantMessage: true,
    runs: runs.map((r) => ({
      ...r,
      queries: [...r.queries],
      sources: r.sources.map((s) => ({ ...s })),
      pages: r.pages.map((p) => ({ ...p })),
    })),
  }
}

export async function POST(request: Request) {
  // ── Admin gate (the API route is NOT under /admin/, so middleware doesn't cover it) ──
  const user = await getCurrentUser()
  if (!user || !isAdmin(user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: {
    threadId?: string
    message?: string
    modelPreference?: ModelPreference
    webMode?: "auto" | "on" | "off"
    webEnabled?: boolean // legacy boolean alias → on/off
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  let rawMessage = (body.message ?? "").trim()
  if (!rawMessage) {
    return Response.json({ error: "Missing message" }, { status: 400 })
  }
  if (rawMessage.length > 4000) {
    return Response.json({ error: "Message too long (≤4000 chars)" }, { status: 413 })
  }

  // ── Web-search trigger ──────────────────────────────────────────────────
  // Tri-state: auto (a pre-turn classifier decides), on (force), off (force).
  // /web and /noweb prefixes force on/off; the legacy webEnabled boolean is
  // aliased to on/off for backward compatibility. Default is auto. The
  // classifier runs later (after history is fetched so it can read prior rows).
  let webMode: "auto" | "on" | "off" = body.webMode ?? (body.webEnabled ? "on" : "auto")
  let message = rawMessage
  let nopost = false
  message = message.replace(/^\/web\s*/i, () => { webMode = "on"; return "" }).trim()
  message = message.replace(/^\/noweb\s*/i, () => { webMode = "off"; return "" }).trim()
  message = message.replace(/^\/nopost\s*/i, () => { nopost = true; return "" }).trim()
  if (!message) {
    return Response.json({ error: "Missing message after prefix" }, { status: 400 })
  }

  // ── Thread ──────────────────────────────────────────────────────────────
  // A supplied threadId must be an existing CHAT thread. A companion thread
  // (purpose='blog-companion') is rejected with 400 — the client cannot
  // repurpose a companion thread as a chat thread (spec §11/§13). A nonexistent
  // thread id falls through to createThread (preserves the first-turn UX).
  let threadId = body.threadId
  let modelPreference = body.modelPreference // optional, unused by the UI today (reserved)
  if (threadId) {
    const t = await getThread(threadId)
    if (t && t.purpose !== "chat") {
      return Response.json({ error: "Thread not available for chat" }, { status: 400 })
    }
    if (!t) threadId = undefined
    else modelPreference = t.model_preference ?? "auto"
  }
  if (!threadId) {
    const t = await createThread(message.slice(0, 60))
    threadId = t.id
    modelPreference = t.model_preference ?? "auto"
  }

  // ── Resolve the model for this turn (once per request) ──────────────────
  // A one-turn override (set by the set_model tool last turn) wins and is
  // consumed. Then a pinned preference. Then auto-routing via the hybrid
  // classifier. Then the default tier. Web-synthesis turns force the large
  // tier (best synthesis, reusing the env-rerouted reasoning model) — the
  // pill/override is still resolved + consumed so it doesn't dangle, then
  // overridden for the actual model on web turns.
  const override = await consumeOneTurnOverride(threadId)
  let tier: ModelTier = DEFAULT_TIER
  let reason = `default (${DEFAULT_TIER})`
  if (override) {
    tier = override
    reason = `override (${override})`
  } else if (modelPreference && modelPreference !== "auto") {
    tier = modelPreference
    reason = `pinned (${modelPreference})`
  } else {
    const { band } = await classifyDifficultyHybrid(message)
    tier = bandToTier(band)
    reason = `auto → ${tier} (${band})`
  }
  // webTurn + final modelId are resolved after history is fetched (the auto
  // path needs prior rows for the needs-web? classifier).

  await appendMessage({ threadId, role: "user", content: message })

  // ── Build prompt context (once) ────────────────────────────────────────
  // Fetched before web research so the query-rewrite step can use recent
  // conversation history to resolve pronouns/shorthand ("他", "that") into the
  // explicit subject the user is asking about.
  const [siteContext, memories, historyRows] = await Promise.all([
    buildSiteContext(),
    recallMemories({ limit: 40 }),
    getMessages(threadId),
  ])
  const history = historyRows.map(rowToMistral).filter((m): m is MistralMessage => m !== null)

  // ── Resolve the web turn + final model (needs history for the classifier) ──
  // on → force search (unless the key is missing). auto → run decideWebEnabled
  // with prior rows; search iff it says so. off → never. webRequested tracks
  // "did the user want web" so we can surface unavailable when the key is missing.
  const tavilyKeyMissing = !process.env.TAVILY_API_KEY
  let webTurn = false
  let webRequested = false
  let webDecision: WebDecision | undefined
  let webDecisionVia: "heuristic" | "mistral-small" | undefined
  if (webMode === "on") {
    webRequested = true
    webTurn = !tavilyKeyMissing
  } else if (webMode === "auto" && !tavilyKeyMissing) {
    const priorRows = historyRows.slice(0, -1) // exclude the just-appended current message
    const decision = await decideWebEnabled(message, priorRows)
    webRequested = decision.webEnabled
    webTurn = decision.webEnabled
    if (decision.webEnabled) {
      webDecision = decision.decision
      webDecisionVia = decision.via
    }
  }
  if (webTurn) {
    tier = "large" // force best synthesis for web-research turns
  }
  const modelId = MODEL_TIERS[tier] ?? MODEL_TIERS[DEFAULT_TIER]

  // ── System prompt (built after webTurn so the newest-post auto-inject loads
  // only on ordinary non-web chat). The post body is injected ONLY on a "new
  // post" review intent, never on a web turn, never when /nopost opted out,
  // never when there are no published posts. It is read-only admin-authored
  // site text — never from web/chat, never into save_memory/infer, never
  // rendered as raw HTML. The read_post tool remains the fallback for any
  // specific/older post. See lib/chat/post-read.ts.
  let postUnderDiscussion: string | null = null
  if (!webTurn && !nopost && detectPostReviewIntent(message)) {
    postUnderDiscussion = await loadNewestPostForPrompt()
  }
  const baseSystemPrompt = buildSystemPrompt({ siteContext, memories, postUnderDiscussion })

  // 55s soft-deadline AbortController (cleared on stream close).
  const deadlineController = new AbortController()
  const deadlineTimer = setTimeout(() => deadlineController.abort(), SOFT_DEADLINE_MS)

  // ── SSE stream + agent loop ─────────────────────────────────────────────
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

      let lastContent = ""
      // Per-turn web-research audit (advisor round 2 Q1). The route owns this
      // array; the pre-turn pipeline pushes a pipeline run, the web_search tool
      // branch pushes a tool run (via ToolContext). Each assistant appendMessage
      // snapshots the runs accumulated so far → capture-by-model-call-visibility.
      // Read-only debug material — never reaches save_memory, never fed back to
      // Mistral (rowToMistral maps only role/content/tool_calls; the web_research
      // jsonb column is invisible to it).
      const webAuditRuns: WebResearchRun[] = []
      try {
        send({ type: "thread", threadId })

        // ── Web research (code-driven depth+breadth pipeline, live phases) ──
        // rewrite+expand → parallel searches → merge/rank → /extract top 2 →
        // bounded evidence. Web text is NEVER persisted to memory and never
        // written to site content; it is injected into this turn's system prompt
        // only, clearly labelled untrusted. If the key is missing, surface
        // unavailable and continue with no web evidence.
        let webEvidence = ""
        let merged: WebResearch = {
          provider: "tavily",
          query: message,
          searchedAt: new Date().toISOString(),
          sources: [],
        }
        let webSubject: string | null = null
        let webQueries: string[] = []
        let pages: ExtractedPage[] = []
        if (webTurn) {
          send({ type: "web_phase", phase: "rewriting" })
          const priorRows = historyRows.slice(0, -1) // exclude the just-appended current message
          const rewrite = await rewriteSearchQueries(message, priorRows)
          webSubject = rewrite.subject
          webQueries = rewrite.queries
          send({ type: "web_phase", phase: "searching" })
          const studies = await Promise.all(webQueries.map((q) => searchWeb(q)))
          merged = mergeWebResearch(studies)
          const ranked = rankSources(merged.sources, webSubject).slice(0, 8)
          merged = { ...merged, sources: ranked }
          if (ranked.length > 0) {
            send({ type: "web_phase", phase: "reading" })
            try {
              const extracted = await extractPages(
                ranked.slice(0, 2).map((s) => s.url),
                webQueries[0] || webSubject || message
              )
              pages = extracted.pages
            } catch {
              pages = [] // missing key / extract unavailable → snippets-only
            }
          }
          send({ type: "web_phase", phase: "done" })
          webEvidence = formatWebEvidenceGuarded(merged, webSubject, pages)
        }

        // ── Co-adaptive effort + budget (web turns) ───────────────────────
        // guard/empty → low + 1500; snippets → medium + 4000; full pages →
        // high + 8000. reasoning_effort is sent only when the resolved large
        // model is reasoning-capable (env pins mistral-medium-3-5); on a
        // non-reasoning large model the effort is dropped (it would reject it).
        const subjectMatch =
          merged.sources.length === 0 || subjectInSources(merged, webSubject)
        let effort: string | undefined
        let webMaxTokens = BASE_MAX_TOKENS
        let modelReason = reason
        if (webTurn) {
          const guardOrEmpty =
            merged.sources.length === 0 || (webSubject != null && !subjectMatch)
          if (guardOrEmpty) {
            effort = "low"
            webMaxTokens = WEB_BUDGET_GUARD
          } else if (pages.length > 0) {
            effort = "high"
            webMaxTokens = WEB_BUDGET_PAGES
          } else {
            effort = "medium"
            webMaxTokens = WEB_BUDGET_SNIPPETS
          }
          const reasoningCapable = !!reasoningEffortForModel(modelId)
          if (!reasoningCapable) effort = undefined
          modelReason = reasoningCapable
            ? `web → large (reasoning, effort: ${effort})`
            : "web → large (non-reasoning)"
        }
        // Push the pipeline run onto the per-turn audit AFTER effort/budget are
        // known so the run records the co-adaptive synthesis tier. The run is a
        // capped, normalized snapshot of what the pipeline supplied this turn.
        if (webTurn) {
          webAuditRuns.push(
            buildPipelineAuditRun({
              mode: webMode === "on" ? "on" : "auto",
              decision: webDecision,
              decisionVia: webDecisionVia,
              queries: webQueries,
              subject: webSubject,
              subjectMatch,
              sources: merged.sources,
              pages,
              evidenceInjected: webEvidence,
              effort,
              maxTokens: webMaxTokens,
              searchedAt: merged.searchedAt,
            })
          )
        }
        send({ type: "model", tier, modelId, reason: modelReason })

        // ── Web sources / status (after the model event) ──────────────────
        if (webRequested && tavilyKeyMissing) {
          send({ type: "web_status", status: "unavailable", reason: "Tavily API key not configured" })
        } else if (webTurn) {
          const readFullUrls = new Set(pages.map((p) => p.url))
          const sourcesWithFlag: (WebSource & { readFull: boolean })[] = merged.sources.map(
            (s) => ({ ...s, readFull: readFullUrls.has(s.url) })
          )
          send({
            type: "web_sources",
            query: merged.query,
            searchedAt: merged.searchedAt,
            sources: sourcesWithFlag,
            subject: webSubject,
            subjectMatch,
            queries: webQueries,
            readFull: sourcesWithFlag.map((s) => s.readFull),
          })
          if (merged.sources.length === 0) {
            send({ type: "web_status", status: "empty", query: merged.query })
          } else if (webSubject && !subjectMatch) {
            send({
              type: "web_status",
              status: "subject_absent",
              subject: webSubject,
              query: merged.query,
            })
          }
        }

        // ── System prompt + messages (web evidence injected this turn only) ──
        const systemPrompt = webEvidence
          ? `${baseSystemPrompt}\n\n${webEvidence}\n\n[REMINDER] The PUBLIC WEB EVIDENCE block above is temporary external evidence for this turn only. It is not Robin's memory, not website content, and not a reason to write memory. The READ IN FULL section is the actual text of the top source(s) — cite it by URL when you use it. If the block states the sources do not mention a subject, do NOT attribute claims to that subject — tell the user you could not confirm from the web. Site context and durable memory remain authoritative for the site; the web block is only for external facts the user asked about.`
          : baseSystemPrompt
        const mistralMessages: MistralMessage[] = [
          { role: "system", content: systemPrompt },
          ...history.slice(0, -1),
          { role: "user", content: message },
        ]

        const toolCtx: ToolContext = {
          sourceThreadId: threadId,
          memoryWrites: 0,
          maxMemoryWrites: MAX_MEMORY_WRITES,
          webTouched: false,
          webSearchCalls: 0,
          webResearch: null,
          webAuditRuns,
        }
        // Seed the web→memory gate snapshot from the first search (best-of;
        // a later web_search follow-up merges into it).
        if (webTurn) {
          toolCtx.webTouched = true
          toolCtx.webResearch = snapshotWebResearch(merged, webSubject, pages)
        }

        let turns = 0
        while (turns < MAX_TURNS) {
          turns += 1
          const isFinalGuess = turns === MAX_TURNS

          // Per-turn reasoning accumulator. onReasoning is a SEPARATE channel
          // from onContent — the trace is captured here for the debug log only
          // and NEVER streamed to the author SSE (extractTextContent already
          // strips thinking from acc.content; onContent carries text only).
          let turnReasoning = ""
          // Stream this turn's content to the client as it arrives.
          const acc = await mistralStream({
            messages: mistralMessages,
            tools: CHAT_TOOLS,
            model: modelId,
            maxTokens: webTurn ? webMaxTokens : isFinalGuess ? BASE_FINAL_MAX_TOKENS : BASE_MAX_TOKENS,
            reasoningEffort: webTurn ? effort : undefined,
            signal: deadlineController.signal,
            onContent: (delta) => {
              lastContent += delta
              send({ type: "content", delta })
            },
            onReasoning: (chunk) => {
              turnReasoning += chunk
            },
          })

          // Turn-level telemetry for the debug log (fields already on
          // AccumulatedMessage; previously dropped).
          const telemetry: DebugTelemetry = {
            response_model: acc.response_model ?? null,
            reasoning_effort_sent: acc.reasoning_effort_sent ?? null,
            content_chunk_types: acc.content_chunk_types ?? null,
            reasoning_chars: acc.reasoning_chars ?? null,
            text_chars: acc.text_chars ?? null,
            finish_reason: acc.finish_reason ?? null,
          }

          // Persist this assistant turn (content + tool_calls + reasoning + telemetry).
          await appendMessage({
            threadId,
            role: "assistant" as MessageRole,
            content: acc.content,
            toolCalls: acc.tool_calls.length > 0 ? acc.tool_calls : undefined,
            model: modelId,
            reasoning: turnReasoning || null,
            telemetry,
            webResearch: snapshotWebResearchAudit(webAuditRuns),
          })

          // No tool calls → conversation turn complete.
          if (acc.tool_calls.length === 0) {
            break
          }

          // Append the assistant tool-call message to the running history.
          mistralMessages.push({
            role: "assistant",
            content: acc.content || null,
            tool_calls: acc.tool_calls,
          })

          // Execute each tool call, feed results back.
          for (const call of acc.tool_calls) {
            send({ type: "tool", name: call.function.name, status: "running" })
            const result = await executeToolCall(
              call.function.name,
              call.function.arguments,
              toolCtx
            )
            send({
              type: "tool",
              name: call.function.name,
              status: "done",
              result: result.content,
            })
            // Persist the tool result message.
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

        send({ type: "done", threadId })
      } catch (err) {
        // Graceful degradation: persist any partial answer already streamed so
        // the thread isn't broken by a mid-stream abort/error, then surface it.
        if (lastContent) {
          try {
            await appendMessage({
              threadId,
              role: "assistant" as MessageRole,
              content: lastContent,
              model: modelId,
              webResearch: snapshotWebResearchAudit(webAuditRuns),
            })
          } catch {
            /* ignore — best-effort partial persistence */
          }
        }
        const msg = err instanceof Error ? err.message : "Chat failed"
        send({ type: "error", message: msg })
      } finally {
        clearTimeout(deadlineTimer)
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