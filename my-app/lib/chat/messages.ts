import type { ChatMessageRow } from "@/lib/db/chat"
import type { MistralMessage, MistralToolCall } from "@/lib/chat/mistral"

/** Map a persisted chat message row to the Mistral API message format.
 *
 * Defensive: assistant rows that have neither content nor tool_calls are
 * invalid per the Mistral API (`invalid_request_assistant_message` 400). They
 * are dropped (return null) so they are filtered out of the history sent to
 * the model. This guards against degenerate rows from prior turns, e.g. an
 * assistant turn that streamed no content and received no tool calls.
 *
 * Tool rows are kept as-is; the route always stores a valid `tool_call_id`
 * alongside them.
 */
export function rowToMistral(row: ChatMessageRow): MistralMessage | null {
  if (row.role === "user") return { role: "user", content: row.content ?? "" }

  if (row.role === "assistant") {
    const tc = row.tool_calls as MistralToolCall[] | null
    const hasToolCalls = tc && tc.length > 0
    const content = row.content && row.content.length > 0 ? row.content : null

    // Mistral rejects assistant messages with no content and no tool_calls.
    if (!content && !hasToolCalls) return null

    const msg: MistralMessage = { role: "assistant", content }
    if (hasToolCalls) msg.tool_calls = tc
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
