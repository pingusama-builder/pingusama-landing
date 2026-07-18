import type { CompanionDebugLog, DebugTelemetry, WebResearchAudit } from "@/lib/db/chat"

/** Render a companion debug log as human-readable Markdown. Pure: no DOM, no
 * env, no side effects. Omits the Reasoning block when reasoning is absent, the
 * Telemetry line when all telemetry fields are null, and the Web research block
 * when no web research was captured for the turn. */
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
      const web = webResearchBlock(m.web_research)
      if (web.length) lines.push("### Web research", "", ...web, "")
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

/** Render the web-research audit as indented lines under a `### Web research`
 *  heading. One bulleted run per entry (pipeline / tool), with queries, subject
 *  + match, guard, sources (with read-in-full flag), extracted pages, effort +
 *  budget, and the injected evidence size. Empty (no runs) → no block. */
function webResearchBlock(a: WebResearchAudit | null): string[] {
  if (!a || !a.runs || a.runs.length === 0) return []
  const out: string[] = []
  for (const r of a.runs) {
    const head = [`via: ${r.via}`, `mode: ${r.mode}`]
    if (r.decision) head.push(`decision: ${r.decision}`)
    if (r.decisionVia) head.push(`via ${r.decisionVia}`)
    out.push(`- ${head.join(", ")}`)
    if (r.queries.length) out.push(`  - queries: ${JSON.stringify(r.queries)}`)
    if (r.subject) out.push(`  - subject: ${r.subject} (match: ${r.subjectMatch})`)
    else out.push(`  - subject: none`)
    out.push(`  - guard: ${r.guard}`)
    if (r.sources.length) {
      const readFull = r.sources.filter((s) => s.readFull).length
      out.push(`  - sources: ${r.sources.length}${readFull ? ` (${readFull} read in full)` : ""}`)
      for (const s of r.sources) {
        out.push(`    - ${s.url} — ${s.title || "(untitled)"}${s.readFull ? " [read in full]" : " [snippet]"}`)
      }
    } else {
      out.push(`  - sources: none`)
    }
    if (r.pages.length) {
      out.push(`  - pages extracted: ${r.pages.length}`)
      for (const p of r.pages) {
        out.push(`    - ${p.url} (${p.charsOriginal} chars${p.truncated ? ", truncated" : ""})`)
      }
    }
    const meta: string[] = []
    if (r.effort) meta.push(`effort: ${r.effort}`)
    if (r.maxTokens != null) meta.push(`maxTokens: ${r.maxTokens}`)
    meta.push(`evidence injected: ${r.evidenceChars} chars`)
    out.push(`  - ${meta.join(", ")}`)
  }
  return out
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
