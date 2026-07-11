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
  COMPANION_TOOLS,
  executeCompanionToolCall,
  type CompanionDraft,
} from "@/lib/chat/companion-tools"
import {
  MODEL_TIERS,
  DEFAULT_TIER,
  type ModelTier,
  type ModelPreference,
} from "@/lib/chat/models"
import { mistralStream, type MistralMessage, type MistralToolCall } from "@/lib/chat/mistral"
import type { DraftSnapshot } from "@/lib/blog/proposals"

export const maxDuration = 60
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
  const systemPrompt = buildCompanionPrompt({
    writingContext,
    memories,
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
        let turns = 0
        while (turns < MAX_TURNS) {
          turns += 1
          const isFinalGuess = turns === MAX_TURNS

          const acc = await mistralStream({
            messages: mistralMessages,
            tools: COMPANION_TOOLS,
            model: modelId,
            maxTokens: isFinalGuess ? 1200 : 800,
            signal: request.signal,
            onContent: (delta) => {
              emitted = true
              send({ type: "content", delta })
            },
          })

          await appendMessage({
            threadId,
            role: "assistant" as MessageRole,
            content: acc.content,
            toolCalls: acc.tool_calls.length > 0 ? acc.tool_calls : undefined,
            model: modelId,
          })

          if (acc.tool_calls.length === 0) break

          mistralMessages.push({
            role: "assistant",
            content: acc.content || null,
            tool_calls: acc.tool_calls,
          })

          for (const call of acc.tool_calls) {
            send({ type: "tool", name: call.function.name, status: "running" })
            const result = await executeCompanionToolCall(
              call.function.name,
              call.function.arguments,
              toolCtx,
              companionDraft
            )
            send({
              type: "tool",
              name: call.function.name,
              status: "done",
              result: result.content,
            })
            if (result.proposal) {
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