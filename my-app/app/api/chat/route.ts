import { getCurrentUser, isAdmin } from "@/lib/auth"
import {
  createThread,
  getThread,
  appendMessage,
  getMessages,
  consumeOneTurnOverride,
  type MessageRole,
} from "@/lib/db/chat"
import { recallMemories } from "@/lib/db/chat"
import { buildSiteContext } from "@/lib/chat/awareness"
import { buildSystemPrompt } from "@/lib/chat/prompt"
import { CHAT_TOOLS, executeToolCall, type ToolContext } from "@/lib/chat/tools"
import {
  searchWeb,
  formatWebEvidence,
  type WebResearch,
} from "@/lib/chat/tavily-search"
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
  type MistralMessage,
} from "@/lib/chat/mistral"
import { rowToMistral } from "@/lib/chat/messages"

export const maxDuration = 60
export const runtime = "nodejs"

const MAX_TURNS = 6
const MAX_MEMORY_WRITES = 3

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
    webEnabled?: boolean
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
  // Explicit per-message toggle (`webEnabled`) or `/web` prefix. Strip the
  // prefix before storing or passing the question onward. Disabled by default.
  let webEnabled = !!body.webEnabled
  const message = rawMessage.replace(/^\/web\s*/i, () => {
    webEnabled = true
    return ""
  }).trim()
  if (!message) {
    return Response.json({ error: "Missing message after /web prefix" }, { status: 400 })
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
  // classifier. Then the default tier.
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
  const modelId = MODEL_TIERS[tier] ?? MODEL_TIERS[DEFAULT_TIER]

  await appendMessage({ threadId, role: "user", content: message })

  // ── Web research (pre-turn, current turn only) ──────────────────────────
  // Web search is disabled by default and only runs when explicitly enabled.
  // It is a temporary evidence lens: results are injected into the current turn
  // and never written to durable memory. If the key is missing, we surface an
  // unavailable status and continue with ordinary chat.
  const tavilyKeyMissing = webEnabled && !process.env.TAVILY_API_KEY
  let webResearch: WebResearch | null = null
  let webEvidence = ""
  if (webEnabled && !tavilyKeyMissing) {
    webResearch = await searchWeb(message)
    webEvidence = formatWebEvidence(webResearch)
  }

  // ── Build prompt context (once) ────────────────────────────────────────
  const [siteContext, memories, historyRows] = await Promise.all([
    buildSiteContext(),
    recallMemories({ limit: 40 }),
    getMessages(threadId),
  ])
  const baseSystemPrompt = buildSystemPrompt({ siteContext, memories })
  const systemPrompt = webEvidence
    ? `${baseSystemPrompt}\n\n${webEvidence}\n\n[REMINDER] The PUBLIC WEB EVIDENCE block above is temporary external evidence for this turn only. It is not Robin's memory, not website content, and not a reason to write memory. Site context and durable memory remain authoritative for the site; the web block is only for external facts the user asked about.`
    : baseSystemPrompt

  const history = historyRows.map(rowToMistral).filter((m): m is MistralMessage => m !== null)
  // Drop the last user message from history (we'll add it fresh to avoid dup),
  // then re-add it.
  const mistralMessages: MistralMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(0, -1),
    { role: "user", content: message },
  ]

  // ── SSE stream + agent loop ─────────────────────────────────────────────
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

      try {
        send({ type: "thread", threadId })
        send({ type: "model", tier, modelId, reason })

        // Web-search status/sources are emitted immediately after the model
        // event so the UI can show whether research happened for this turn.
        if (tavilyKeyMissing) {
          send({ type: "web_status", status: "unavailable", reason: "Tavily API key not configured" })
        } else if (webEnabled && webResearch) {
          send({
            type: "web_sources",
            query: webResearch.query,
            searchedAt: webResearch.searchedAt,
            sources: webResearch.sources,
          })
          if (webResearch.sources.length === 0) {
            send({ type: "web_status", status: "empty", query: webResearch.query })
          }
        }

        const toolCtx: ToolContext = {
          sourceThreadId: threadId,
          memoryWrites: 0,
          maxMemoryWrites: MAX_MEMORY_WRITES,
        }

        let turns = 0
        let lastContent = ""
        while (turns < MAX_TURNS) {
          turns += 1
          const isFinalGuess = turns === MAX_TURNS

          // Stream this turn's content to the client as it arrives.
          const acc = await mistralStream({
            messages: mistralMessages,
            tools: CHAT_TOOLS,
            model: modelId,
            maxTokens: isFinalGuess ? 1200 : 600,
            onContent: (delta) => {
              lastContent += delta
              send({ type: "content", delta })
            },
          })

          // Persist this assistant turn (content + any tool_calls).
          await appendMessage({
            threadId,
            role: "assistant" as MessageRole,
            content: acc.content,
            toolCalls: acc.tool_calls.length > 0 ? acc.tool_calls : undefined,
            model: modelId,
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
        const msg = err instanceof Error ? err.message : "Chat failed"
        send({ type: "error", message: msg })
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