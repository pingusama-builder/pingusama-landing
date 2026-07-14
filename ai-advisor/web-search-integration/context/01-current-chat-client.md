# Current chat/blog-companion Mistral client (verbatim)

This is the thin client every existing route uses. It is hard-wired to `/v1/chat/completions` and supports streaming tool calls.

## my-app/lib/chat/mistral.ts (relevant excerpt)

```ts
export const MISTRAL_ENDPOINT =
  "https://api.mistral.ai/v1/chat/completions"

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
  response_model?: string
  content_chunk_types?: string[]
  reasoning_chars?: number
  text_chars?: number
  reasoning_effort_sent?: string | null
}

async function callMistral(opts: CallOptions, stream: boolean): Promise<AccumulatedMessage> {
  // ... builds body with model, messages, tools, tool_choice, max_tokens, temperature, stream
  const res = await fetch(MISTRAL_ENDPOINT, { ... })
  // parses SSE or JSON response
}
```

**Key observation:** the client only knows `/v1/chat/completions`. Mistral's built-in `web_search` connector does NOT work on this endpoint (per Mistral docs); it only works on `/v1/conversations` and `/v1/agents`, which have a different request/response shape (`inputs`, `outputs`, `tool_reference` citation chunks).
