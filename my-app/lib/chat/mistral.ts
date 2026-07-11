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

interface CallOptions {
  messages: MistralMessage[]
  tools?: MistralTool[]
  toolChoice?: ToolChoice
  maxTokens?: number
  signal?: AbortSignal
  onContent?: (chunk: string) => void
}

async function callMistral(opts: CallOptions, stream: boolean): Promise<AccumulatedMessage> {
  const body: Record<string, unknown> = {
    model: getMistralModel(),
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 1000,
    temperature: 0.4,
    stream: stream,
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
    body.tool_choice = opts.toolChoice ?? "auto"
  }

  const res = await fetch(MISTRAL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getMistralApiKey()}`,
      "Content-Type": "application/json",
      Accept: stream ? "text/event-stream" : "application/json",
    },
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
      choices: { message: { content: string | null; tool_calls?: MistralToolCall[] }; finish_reason: string | null }[]
    }
    const choice = json.choices?.[0]
    return {
      role: "assistant",
      content: choice?.message?.content ?? "",
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
        content += delta.content
        opts.onContent?.(delta.content)
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