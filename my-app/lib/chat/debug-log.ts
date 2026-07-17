import type { CompanionDebugLog, DebugTelemetry } from "@/lib/db/chat"

/** Render a companion debug log as human-readable Markdown. Pure: no DOM, no
 * env, no side effects. Omits the Reasoning block when reasoning is absent and
 * the Telemetry line when all telemetry fields are null. */
export function debugLogToMarkdown(log: CompanionDebugLog): string {
  const { thread, exportedAt, messages } = log
  const lines: string[] = []
  lines.push(`# Debug log — ${thread.title}`, "")
  lines.push(`Thread: ${thread.id}`)
  lines.push(`Created: ${thread.created_at}`)
  lines.push(`Updated: ${thread.updated_at}`)
  lines.push(`Model preference: ${thread.model_preference ?? "auto"}`)
  lines.push(`Exported: ${exportedAt}`, "")
  lines.push("---", "")

  for (const m of messages) {
    const ts = m.created_at
    if (m.role === "assistant") {
      lines.push(`## [assistant] · ${ts} · model: ${m.model ?? "unknown"}`, "")
      lines.push(m.content ?? "", "")
      const tel = telemetryLine(m.telemetry)
      if (tel) lines.push(`**Telemetry:** ${tel}`, "")
      const calls = toolCallList(m.tool_calls)
      if (calls) lines.push("**Tool calls:**", calls, "")
      if (m.reasoning && m.reasoning.trim()) lines.push("### Reasoning", "", m.reasoning, "")
    } else if (m.role === "tool") {
      const name = toolName(m.tool_calls)
      lines.push(`## [tool] · ${ts}${name ? ` · tool: ${name}` : ""}`, "")
      lines.push(m.content ?? "", "")
    } else {
      lines.push(`## [user] · ${ts}`, "", m.content ?? "", "")
    }
    lines.push("---", "")
  }
  return lines.join("\n")
}

function telemetryLine(t: DebugTelemetry | null): string {
  if (!t) return ""
  const parts: string[] = []
  if (t.response_model) parts.push(`response_model=${t.response_model}`)
  if (t.reasoning_effort_sent) parts.push(`reasoning_effort=${t.reasoning_effort_sent}`)
  if (t.reasoning_chars != null) parts.push(`reasoning_chars=${t.reasoning_chars}`)
  if (t.text_chars != null) parts.push(`text_chars=${t.text_chars}`)
  if (t.finish_reason) parts.push(`finish_reason=${t.finish_reason}`)
  if (t.content_chunk_types?.length) parts.push(`chunk_types=[${t.content_chunk_types.join(",")}]`)
  return parts.join(", ")
}

function toolCallList(tc: unknown): string {
  if (!Array.isArray(tc)) return ""
  const out: string[] = []
  for (const c of tc) {
    const fn = (c as { function?: { name?: string; arguments?: string } })?.function
    if (fn?.name) out.push(`- ${fn.name}(${fn.arguments ?? ""})`)
  }
  return out.join("\n")
}

function toolName(tc: unknown): string {
  if (tc && typeof tc === "object" && "name" in tc) {
    return String((tc as { name?: unknown }).name ?? "")
  }
  return ""
}