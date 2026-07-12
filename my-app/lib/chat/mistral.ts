// Thin client over the Mistral La Plateforme chat completions API.
// https://docs.mistral.ai/api/endpoint/chat  — POST /v1/chat/completions
// Supports streaming + native function/tool calling. No SDK dependency:
// we shape the requests ourselves so the tool surface stays explicitly
// controlled (see lib/chat/tools.ts — only memory + read tools, never site writes).

export interface MistralMessage {
  role: "system" | "user" | "assistant" | "tool"
  content?: string | null
  tool_calls?: MistralToolCall[]
  tool_call_id?: string // for role: "tool"
}

export interface MistralToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface MistralTool {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ToolChoice =
  | "auto"
  | "none"
  | { type: "function"; function: { name: string } }

export interface AccumulatedMessage {
  role: "assistant"
  content: string
  tool_calls: MistralToolCall[]
  finish_reason: string | null
}

export const MISTRAL_ENDPOINT =
  "https://api.mistral.ai/v1/chat/completions"

// ── Ollama substrate check (advisor phase B8 Q7) ──────────────────────────
// When OLLAMA_BASE_URL is set, this client routes to a local Ollama instance's
// OpenAI-compatible /v1/chat/completions endpoint instead of Mistral. The
// streamed tool-call delta shape Ollama emits matches the OpenAI shape this
// parser already handles, so the route, the tool dispatcher (allowlist +
// propose_edit pure), and the prompt are unchanged — only the HTTP destination
// and model name differ. This is a LOCAL-ONLY experiment (Ollama is not
// deployable to Vercel); unset OLLAMA_BASE_URL to restore Mistral. The security
// boundary (no site-write imports, deny-by-default tool allowlist) is
// untouched — Ollama is reachable only through the same constrained client.
export function isOllamaBackend(): boolean {
  return !!process.env.OLLAMA_BASE_URL
}

function getOllamaModel(): string {
  const m = process.env.OLLAMA_MODEL
  if (!m) {
    throw new Error(
      "OLLAMA_BASE_URL is set but OLLAMA_MODEL is not. Set OLLAMA_MODEL to the Ollama tag (e.g. glm5.2) you pulled locally."
    )
  }
  return m
}

function resolveEndpoint(): string {
  if (isOllamaBackend()) {
    const base = process.env.OLLAMA_BASE_URL!.replace(/\/+$/, "")
    return `${base}/v1/chat/completions`
  }
  return MISTRAL_ENDPOINT
}

export function getMistralApiKey(): string {
  const key = process.env.MISTRAL_API_KEY
  if (!key) {
    throw new Error(
      "MISTRAL_API_KEY is not set. Add it to .env.local (https://console.mistral.ai/api-keys) and restart."
    )
  }
  return key
}

export function getMistralModel(): string {
  return process.env.MISTRAL_MODEL || "mistral-medium-latest"
}

// ── Mistral in-place reasoning substrate check (advisor phase B8 Q7) ──────
// When COMPANION_REASONING_EFFORT is set (e.g. "high"), the full-review tier
// (`large`) is rerouted to a reasoning-capable Mistral model (default
// `mistral-medium-3-5`; override via MISTRAL_REASONING_MODEL — see
// lib/chat/models.ts) and THIS client sends a root-level `reasoning_effort`
// param for that model only. small/medium tiers are NOT coerced, so the param
// never reaches a model that rejects it (`mistral-medium-latest`,
// `mistral-large-latest`). Dormant when unset — the production Mistral path is
// identical to before. This is a deployable substrate check (same provider,
// same Vercel runtime, no Ollama): option 2 Path A in
// ai-advisor/refinement-03-fiction-examples-extension/eval/lane-decision-research.md.
// The Ollama substrate (`OLLAMA_BASE_URL`) takes precedence over this one.
//
// SAFETY — thinking must never reach the author: Mistral does NOT put reasoning
// in a separate `reasoning_content` field. With reasoning_effort "high" the
// reasoning trace is embedded INSIDE `content` as typed chunks (a `ThinkChunk`
// type:"thinking" holding the trace, then a `TextChunk` type:"text" holding
// the answer; in streaming, `delta.content` alternates between a chunk array
// during thinking and a plain string during the answer phase). A naive
// A direct append of delta.content would coerce a chunk-array to a string and stream
// the model's internal reasoning into the author-facing SSE. `extractTextContent`
// is the post-output mechanical guard that holds regardless of substrate: it
// extracts only text, ignores thinking, and drops any unknown shape to safe-
// empty (a visible failure in a trace) rather than risk stringifying reasoning.
export function getReasoningEffort(): string | undefined {
  return process.env.COMPANION_REASONING_EFFORT
}

export function getReasoningModel(): string {
  return process.env.MISTRAL_REASONING_MODEL || "mistral-medium-3-5"
}

/** True only when this per-call model is the pinned reasoning model AND the
 * reasoning substrate is active (env set) AND we are not on the Ollama path
 * (Ollama substrate wins). Read at call time so tests can flip the env. */
export function isReasoningModel(model: string): boolean {
  if (isOllamaBackend()) return false
  if (!getReasoningEffort()) return false
  return model === getReasoningModel()
}

/** Extract author-facing text from a content payload that may be a plain
 * string (non-reasoning + answer phase) OR an array of typed chunks (Mistral
 * ThinkChunk type:"thinking" + TextChunk type:"text" during the reasoning
 * phase). Emits ONLY text; never leaks thinking. Unknown shapes → "" (safe
 * empty, not a stringify). Pure + env-free so it is directly unit-testable. */
export function extractTextContent(content: unknown): string {
  if (content == null) return ""
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  let out = ""
  for (const chunk of content) {
    if (typeof chunk === "string") {
      out += chunk
    } else if (
      chunk &&
      typeof chunk === "object" &&
      (chunk as { type?: string }).type === "text" &&
      typeof (chunk as { text?: unknown }).text === "string"
    ) {
      out += (chunk as { text: string }).text
    }
    // type:"thinking" / unknown shapes → ignored (never leaked)
  }
  return out
}

interface CallOptions {
  messages: MistralMessage[]
  tools?: MistralTool[]
  toolChoice?: ToolChoice
  maxTokens?: number
  model?: string
  signal?: AbortSignal
  onContent?: (chunk: string) => void
}

async function callMistral(opts: CallOptions, stream: boolean): Promise<AccumulatedMessage> {
  const ollama = isOllamaBackend()
  // On the Ollama path, coerce every caller's model to the local Ollama tag so a
  // mistral tier id (mistral-large-latest) or the inference model never reaches
  // Ollama (which would 404 on an unknown model). On the Mistral path, keep the
  // per-call model override / default resolution.
  const model = ollama ? getOllamaModel() : opts.model ?? getMistralModel()
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 1000,
    temperature: 0.4,
    stream: stream,
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
    body.tool_choice = opts.toolChoice ?? "auto"
  }

  // Reasoning substrate: send the root-level param only to the pinned reasoning
  // model (mistral-medium-3-5 by default). medium-latest / large-latest reject
  // reasoning_effort → isReasoningModel is false for them, so it is never sent.
  if (!ollama && isReasoningModel(model)) {
    body.reasoning_effort = getReasoningEffort()
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: stream ? "text/event-stream" : "application/json",
  }
  if (ollama) {
    // Ollama's OpenAI endpoint needs no Bearer key; an optional key is honored
    // if set (e.g. behind a proxy).
    const key = process.env.OLLAMA_API_KEY
    if (key) headers.Authorization = `Bearer ${key}`
  } else {
    headers.Authorization = `Bearer ${getMistralApiKey()}`
  }

  const res = await fetch(resolveEndpoint(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!res.ok) {
    let detail = ""
    try {
      detail = await res.text()
    } catch {
      /* ignore */
    }
    throw new Error(
      `Mistral API error ${res.status}: ${detail.slice(0, 300) || res.statusText}`
    )
  }

  if (!stream) {
    const json = (await res.json()) as {
      choices: { message: { content: unknown; tool_calls?: MistralToolCall[] }; finish_reason: string | null }[]
    }
    const choice = json.choices?.[0]
    return {
      role: "assistant",
      content: extractTextContent(choice?.message?.content),
      tool_calls: choice?.message?.tool_calls ?? [],
      finish_reason: choice?.finish_reason ?? null,
    }
  }

  // Stream: parse SSE, emit content chunks, accumulate tool_calls by index.
  if (!res.body) throw new Error("Mistral stream had no body")
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let content = ""
  const toolCalls: Record<number, MistralToolCall> = {}
  let finishReason: string | null = null

  const processLine = (line: string) => {
    if (!line.startsWith("data:")) return
    const payload = line.slice(5).trim()
    if (payload === "[DONE]") return
    try {
      const evt = JSON.parse(payload) as {
        choices?: {
          delta?: {
            content?: string | null
            tool_calls?: {
              index: number
              id?: string
              function?: { name?: string; arguments?: string }
            }[]
          }
          finish_reason?: string | null
        }[]
      }
      const choice = evt.choices?.[0]
      const delta = choice?.delta
      if (delta?.content) {
        // Reasoning substrate: delta.content may be a chunk array (ThinkChunk +
        // TextChunk) during the thinking phase. Extract ONLY text so the model's
        // internal reasoning never reaches the author-facing onContent stream.
        const text = extractTextContent(delta.content)
        if (text) {
          content += text
          opts.onContent?.(text)
        }
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls[tc.index]
          if (!existing) {
            toolCalls[tc.index] = {
              id: tc.id ?? `call_${tc.index}`,
              type: "function",
              function: {
                name: tc.function?.name ?? "",
                arguments: tc.function?.arguments ?? "",
              },
            }
          } else {
            if (tc.function?.name) existing.function.name += tc.function.name
            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
          }
        }
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason
    } catch {
      // ignore malformed keepalive lines
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) processLine(line)
    }
  }
  if (buffer.trim()) processLine(buffer.trim())

  return {
    role: "assistant",
    content,
    tool_calls: Object.keys(toolCalls)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => toolCalls[Number(k)])
      .filter((tc) => tc.function.name),
    finish_reason: finishReason,
  }
}

/** Non-streaming call (used for tool-call turns so we can execute and loop). */
export function mistralTurn(opts: CallOptions): Promise<AccumulatedMessage> {
  return callMistral(opts, false)
}

/** Streaming call — emits content chunks via onContent, returns the full message. */
export function mistralStream(opts: CallOptions): Promise<AccumulatedMessage> {
  return callMistral(opts, true)
}