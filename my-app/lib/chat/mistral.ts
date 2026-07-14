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
  // Advisor phase B9 telemetry (observability for the narrow-scope substrate
  // experiment — see VERDICT-phaseB9.md Q1). response_model is the model the API
  // echoed back, the DECISIVE confound field (the configured alias is NOT proof
  // of which model answered: the alias could resolve unexpectedly, the provider
  // could return a different concrete model, an SDK/proxy could transform the
  // request, or the parser could misclassify). content_chunk_types are the
  // typed chunk types seen in delta.content (thinking vs text) — a thinking
  // chunk without reasoning_effort sent would mean native/default reasoning.
  // reasoning_chars / text_chars are char proxies for token counts (no tokenizer
  // available; sufficient to spot a 12k-char flood vs a 200-char answer).
  // reasoning_effort_sent is the effort param actually sent (or null) — the
  // requested alias alone does not tell us whether the param reached the model.
  response_model?: string
  content_chunk_types?: string[]
  reasoning_chars?: number
  text_chars?: number
  reasoning_effort_sent?: string | null
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

// ── Narrow-scope substrate override (advisor phase B9 Q3 A/B test) ─────────
// Dormant when unset. When COMPANION_NARROW_SUBSTRATE is "model|effort" (e.g.
// "mistral-medium-3-5|high" or "mistral-medium-3-5|none"), the medium tier
// resolves to `model` (see lib/chat/models.ts) and THIS client sends `effort`
// as the root-level reasoning_effort for that model — so the three-arm matched
// narrow-scope test (baseline mistral-medium-latest / 3.5+high / 3.5+none) can
// run with NO prompt, tool, cap, or security change. Malformed → null (dormant).
// The Ollama path always wins over this override (Ollama is its own substrate).
// See ai-advisor/refinement-03-fiction-examples-extension/VERDICT-phaseB9.md Q3.
export function getNarrowSubstrate(): { model: string; effort: string } | null {
  const raw = process.env.COMPANION_NARROW_SUBSTRATE
  if (!raw) return null
  const sep = raw.indexOf("|")
  if (sep <= 0 || sep >= raw.length - 1) return null
  return { model: raw.slice(0, sep).trim(), effort: raw.slice(sep + 1).trim() }
}

/** The reasoning_effort to send for a given per-call model, or undefined to
 * omit the param. Pinned reasoning model → COMPANION_REASONING_EFFORT;
 * narrow-substrate override model → its override effort; everything else →
 * undefined (the param is never sent to a model that rejects it, e.g.
 * mistral-medium-latest which is not documented as adjustable-reasoning).
 * Ollama path → always undefined (its substrate does not take this param).
 * Read at call time so tests can flip the env. */
export function reasoningEffortForModel(model: string): string | undefined {
  if (isOllamaBackend()) return undefined
  if (isReasoningModel(model)) return getReasoningEffort()
  const ns = getNarrowSubstrate()
  if (ns && model === ns.model) return ns.effort
  return undefined
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

/** Extract the model's internal reasoning trace from a content payload — the
 * MIRROR of extractTextContent. Mistral-r embeds the trace in a
 * type:"thinking" chunk whose `thinking` field is ITSELF an array of
 * {type:"text"} sub-chunks (the real shape, per the substrate check), so we
 * reuse extractTextContent to pull the text out of that nested array. Flat
 * string variants are read defensively. This feeds the author-facing
 * "Thinking…" UI panel on a SEPARATE channel — extractTextContent still drops
 * thinking from `content`, so the two partition a chunk array with no leakage
 * either way. Plain-string content → "" (reasoning never rides the answer
 * string). Unknown shapes → "" (safe empty). Pure + env-free → unit-testable. */
export function extractReasoningContent(content: unknown): string {
  if (!Array.isArray(content)) return ""
  let out = ""
  for (const chunk of content) {
    if (
      chunk &&
      typeof chunk === "object" &&
      (chunk as { type?: string }).type === "thinking"
    ) {
      const c = chunk as { thinking?: unknown; text?: unknown; reasoning?: unknown }
      if (Array.isArray(c.thinking)) {
        out += extractTextContent(c.thinking)
      } else if (typeof c.thinking === "string") {
        out += c.thinking
      } else if (typeof c.text === "string") {
        out += c.text
      } else if (typeof c.reasoning === "string") {
        out += c.reasoning
      }
    }
  }
  return out
}

interface CallOptions {
  messages: MistralMessage[]
  tools?: MistralTool[]
  toolChoice?: ToolChoice
  maxTokens?: number
  model?: string
  /** Per-call reasoning_effort override. Applied ONLY when the resolved model is
   * reasoning-capable (reasoningEffortForModel(model) is truthy — i.e. the env
   * pins a reasoning model and this call routes to it). On a non-reasoning model
   * the override is ignored (sending reasoning_effort to mistral-large-latest
   * would be rejected). When omitted, the env-driven effort is used (unchanged). */
  reasoningEffort?: string
  signal?: AbortSignal
  onContent?: (chunk: string) => void
  onReasoning?: (chunk: string) => void
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

  // Reasoning substrate (advisor phase B8 Q7 + phase B9 narrow override): send
  // the root-level reasoning_effort only for a model that accepts it — the
  // pinned reasoning model, OR the narrow-substrate override model (so the A/B
  // arms 3.5+high / 3.5+none can run with no other change). reasoning_effort_sent
  // is captured for telemetry; the DECISIVE confound field is response_model, not
  // the alias we requested.
  let reasoningEffortSent: string | null = null
  if (!ollama) {
    // baseEffort is the env-driven effort for this model (undefined unless the
    // model is the pinned reasoning model or the narrow-substrate override). The
    // per-call override takes precedence but ONLY on a reasoning-capable model;
    // on a non-reasoning model baseEffort is undefined and we send nothing.
    const baseEffort = reasoningEffortForModel(model)
    const effort = baseEffort ? (opts.reasoningEffort ?? baseEffort) : undefined
    if (effort) {
      body.reasoning_effort = effort
      reasoningEffortSent = effort
    }
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
      model?: string
      choices: { message: { content: unknown; tool_calls?: MistralToolCall[] }; finish_reason: string | null }[]
    }
    const choice = json.choices?.[0]
    return {
      role: "assistant",
      content: extractTextContent(choice?.message?.content),
      tool_calls: choice?.message?.tool_calls ?? [],
      finish_reason: choice?.finish_reason ?? null,
      response_model: typeof json.model === "string" && json.model ? json.model : undefined,
      reasoning_effort_sent: reasoningEffortSent,
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
  // Advisor phase B9 telemetry accumulators. responseModel is the model the API
  // echoes back (the decisive confound field). chunkTypes tracks the typed chunk
  // types seen in delta.content arrays (thinking vs text). reasoningChars is a
  // char proxy for the reasoning-token count (no tokenizer; sufficient to spot a
  // 12k-char flood vs a 200-char answer).
  let responseModel = ""
  const chunkTypes = new Set<string>()
  let reasoningChars = 0

  const processLine = (line: string) => {
    if (!line.startsWith("data:")) return
    const payload = line.slice(5).trim()
    if (payload === "[DONE]") return
    try {
      const evt = JSON.parse(payload) as {
        model?: string
        choices?: {
          delta?: {
            content?: unknown
            reasoning_content?: string | null
            tool_calls?: {
              index: number
              id?: string
              function?: { name?: string; arguments?: string }
            }[]
          }
          finish_reason?: string | null
        }[]
      }
      // Capture the model the API echoes back (decisive confound field — the
      // configured alias is NOT proof of which model answered). Use the first
      // non-empty model field; providers echo it on every chunk.
      if (typeof evt.model === "string" && evt.model && !responseModel) {
        responseModel = evt.model
      }
      const choice = evt.choices?.[0]
      const delta = choice?.delta
      if (delta?.content) {
        // Reasoning substrate: delta.content may be a chunk array (ThinkChunk +
        // TextChunk). Forward text to the author; forward thinking to the
        // reasoning channel. extractTextContent drops thinking; extractReasoningContent
        // drops text — together they partition the array with no leakage either way.
        // Track the typed chunk types for telemetry (thinking present without
        // reasoning_effort sent ⇒ native/default reasoning, the confound signal).
        if (Array.isArray(delta.content)) {
          for (const c of delta.content) {
            if (c && typeof c === "object" && typeof (c as { type?: string }).type === "string") {
              chunkTypes.add((c as { type: string }).type)
            }
          }
        }
        const text = extractTextContent(delta.content)
        if (text) {
          content += text
          opts.onContent?.(text)
        }
        const reasoning = extractReasoningContent(delta.content)
        if (reasoning) {
          reasoningChars += reasoning.length
          opts.onReasoning?.(reasoning)
        }
      }
      if (delta?.reasoning_content) {
        // GLM (Ollama) puts reasoning in a separate string field, not chunked.
        reasoningChars += delta.reasoning_content.length
        opts.onReasoning?.(delta.reasoning_content)
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
    response_model: responseModel || undefined,
    content_chunk_types: chunkTypes.size ? [...chunkTypes] : undefined,
    reasoning_chars: reasoningChars || undefined,
    text_chars: content.length || undefined,
    reasoning_effort_sent: reasoningEffortSent,
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