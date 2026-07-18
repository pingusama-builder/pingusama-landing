import { createServiceClient } from "@/lib/supabase/server"
import type { ModelPreference, ModelTier } from "@/lib/chat/models"

// ── Memory + conversation store for the site-aware chatbot ──────────────
// Service-role only (RLS enabled, no public policies). The bot's writes are
// confined to these tables; site-content write functions are never imported
// here, so prompt injection cannot reach posts/books/bench/storage.

export type MemoryType =
  | "user"
  | "feedback"
  | "project"
  | "reference"
  | "idea"
  | "site"

export const MEMORY_TYPES: MemoryType[] = [
  "user",
  "feedback",
  "project",
  "reference",
  "idea",
  "site",
]

export type MessageRole = "user" | "assistant" | "tool"

export interface MemoryRow {
  id: string
  type: MemoryType
  name: string
  description: string
  content: string
  links: string[]
  source_thread_id: string | null
  source: string
  fingerprint: string | null
  last_used_at: string
  last_synced_at: string | null
  created_at: string
  updated_at: string
  active: boolean
}

export interface ChatThread {
  id: string
  title: string
  created_at: string
  updated_at: string
  model_preference: ModelPreference | null
  one_turn_override: ModelTier | null
  last_inferred_at: string | null
  purpose: string
  subject_type: string | null
  subject_key: string | null
}

export interface DebugTelemetry {
  response_model?: string | null
  reasoning_effort_sent?: string | null
  content_chunk_types?: string[] | null
  reasoning_chars?: number | null
  text_chars?: number | null
  finish_reason?: string | null
}

// ── Web-research audit (advisor round 2 Q1) ───────────────────────────────
// Per-assistant-call record of the public-web evidence available to the model
// when it produced an assistant message. One WebResearchAudit per assistant
// row, with an ordered runs[] array covering every web path that fed that call
// (pre-turn pipeline, web_search tool follow-up, or both). Read-only debug
// material: NOT chat content, NOT durable memory, NOT input to save_memory or
// history reconstruction. Invisible to rowToMistral (maps only role/content/
// tool_calls), so it cannot feed stale web evidence back into next turn's
// history. Assistant rows only; user/tool rows carry null.
export interface WebResearchSourceAudit {
  url: string
  title: string
  snippet: string
  readFull: boolean
}
export interface WebResearchPageAudit {
  url: string
  extractedText: string
  charsOriginal: number
  truncated: boolean
}
export interface WebResearchRun {
  via: "pipeline" | "tool"
  mode: "auto" | "on" | "tool"
  decision?: "search" | "no-search" | "site-only"
  decisionVia?: "heuristic" | "mistral-small"
  queries: string[]
  subject: string | null
  subjectMatch: boolean
  guard: "none" | "empty" | "subject_absent"
  sources: WebResearchSourceAudit[]
  pages: WebResearchPageAudit[]
  evidenceInjected: string
  evidenceChars: number
  effort: "low" | "medium" | "high" | null
  maxTokens: number | null
  searchedAt: string
}
export interface WebResearchAudit {
  schemaVersion: 1
  availableToAssistantMessage: true
  runs: WebResearchRun[]
}

export interface CompanionDebugLog {
  thread: {
    id: string
    title: string
    created_at: string
    updated_at: string
    model_preference: ModelPreference | null
  }
  exportedAt: string
  messages: Array<{
    id: string
    role: MessageRole
    content: string | null
    created_at: string
    model: string | null
    tool_calls: unknown | null
    reasoning: string | null
    telemetry: DebugTelemetry | null
    web_research: WebResearchAudit | null
  }>
}

export interface ChatMessageRow {
  id: string
  thread_id: string
  role: MessageRole
  content: string | null
  tool_calls: unknown | null
  model: string | null
  reasoning: string | null
  telemetry: DebugTelemetry | null
  web_research: WebResearchAudit | null
  created_at: string
}

function client() {
  return createServiceClient()
}

function handle(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

// ── Validation ──────────────────────────────────────────────────────────
// Names are kebab slugs (a-z0-9-), optionally namespaced with a colon for
// site awareness (site:blog). Server validates before any DB call so tool
// args from the model can never reach SQL unsanitized.
export const NAME_RE = /^[a-z0-9][a-z0-9:-]{0,79}$/
export const MAX_CONTENT = 8000
export const MAX_DESCRIPTION = 300

export function isValidName(name: string): boolean {
  return NAME_RE.test(name)
}

export function assertMemoryInput(input: {
  type: string
  name: string
  description?: string
  content?: string
  links?: string[]
}): void {
  if (!MEMORY_TYPES.includes(input.type as MemoryType)) {
    throw new Error(`Invalid memory type: ${input.type}`)
  }
  if (!isValidName(input.name)) {
    throw new Error(
      `Invalid memory name: must be lowercase kebab (a-z 0-9 - :), ≤80 chars`
    )
  }
  if (input.description != null && input.description.length > MAX_DESCRIPTION) {
    throw new Error(`Description too long (≤${MAX_DESCRIPTION} chars)`)
  }
  if (input.content != null && input.content.length > MAX_CONTENT) {
    throw new Error(`Content too long (≤${MAX_CONTENT} chars)`)
  }
  if (input.links && !input.links.every(isValidName)) {
    throw new Error(`Links must each be a valid memory name`)
  }
}

// Personal-memory tools may not touch the auto-maintained site:* namespace.
// refresh_awareness owns those; this keeps injection from clobbering awareness
// via save_memory/update_memory.
export function assertPersonalName(name: string): void {
  if (name.startsWith("site:")) {
    throw new Error(
      `Names starting with "site:" are managed by refresh_awareness, not save_memory/update_memory`
    )
  }
}

// Writing-preference names live in the "writing-" namespace (companion only).
// They must NOT collide with the chat's personal memories and must never touch
// the site:* namespace. assertPersonalName rejects site:*; isValidName enforces
// the kebab format so a malformed name (spaces, caps) can never reach the DB.
export function assertWritingPrefName(name: string): void {
  assertPersonalName(name)
  if (!name.startsWith("writing-")) {
    throw new Error(
      `Writing-preference names must start with "writing-" (got "${name}")`
    )
  }
  if (!isValidName(name)) {
    throw new Error(
      `Invalid writing-preference name: must be lowercase kebab (a-z 0-9 - :), ≤80 chars`
    )
  }
}

// ── Recall (the single chokepoint) ───────────────────────────────────────
// Query-aware from day one so callers don't change when we swap to filtered /
// semantic recall later. Today: all active memories, most-recently-used first,
// with optional type/category filters; bumps last_used_at for what we return.
export interface RecallOptions {
  query?: string
  types?: MemoryType[]
  category?: string // site category, e.g. "blog" → name "site:blog"
  includeSite?: boolean // default true
  limit?: number
}

export async function recallMemories(
  opts: RecallOptions = {}
): Promise<MemoryRow[]> {
  const limit = opts.limit ?? 40
  const c = client()
  let q = c.from("chat_memories").select("*").eq("active", true)

  if (opts.types && opts.types.length > 0) {
    q = q.in("type", opts.types)
  }
  if (opts.category) {
    q = q.eq("name", `site:${opts.category}`)
  } else if (opts.includeSite === false) {
    q = q.neq("type", "site")
  }
  // ordering: site awareness first (so the bot always has current site model),
  // then most-recently-used personal memories.
  q = q.order("type", { ascending: false }).order("last_used_at", {
    ascending: false,
  }).limit(limit)

  const { data, error } = await q
  handle(error)

  const rows = (data ?? []) as MemoryRow[]
  // Bump last_used_at for returned rows (feeds future relevance). Best-effort.
  if (rows.length > 0) {
    await c
      .from("chat_memories")
      .update({ last_used_at: new Date().toISOString() })
      .in(
        "id",
        rows.map((r) => r.id)
      )
      .then(({ error: e }) => {
        if (e) console.warn("recallMemories last_used_at bump failed:", e.message)
      })
  }
  return rows
}

// ── Memory writes (bot tools) ────────────────────────────────────────────
export interface SaveMemoryInput {
  type: MemoryType
  name: string
  description: string
  content: string
  links?: string[]
  sourceThreadId?: string
  source?: "chat" | "inference" | "web"
}

export async function saveMemory(input: SaveMemoryInput): Promise<MemoryRow> {
  assertMemoryInput(input)
  assertPersonalName(input.name)
  const c = client()
  const now = new Date().toISOString()
  const row = {
    type: input.type,
    name: input.name,
    description: input.description,
    content: input.content,
    links: input.links ?? [],
    source_thread_id: input.sourceThreadId ?? null,
    source: input.source ?? "chat",
    last_used_at: now,
    updated_at: now,
    active: true,
  }
  // Upsert on (active, name): update if an active memory with this name exists.
  const { data: existing } = await c
    .from("chat_memories")
    .select("id")
    .eq("name", input.name)
    .eq("active", true)
    .maybeSingle()
  if (existing) {
    const { data, error } = await c
      .from("chat_memories")
      .update(row)
      .eq("id", existing.id)
      .select("*")
      .single()
    handle(error)
    return data as MemoryRow
  }
  const { data, error } = await c
    .from("chat_memories")
    .insert(row)
    .select("*")
    .single()
  handle(error)
  return data as MemoryRow
}

export async function updateMemory(
  name: string,
  patch: { content?: string; description?: string }
): Promise<MemoryRow> {
  assertPersonalName(name)
  assertMemoryInput({ type: "project", name, ...patch })
  const c = client()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.content != null) update.content = patch.content
  if (patch.description != null) update.description = patch.description
  const { data, error } = await c
    .from("chat_memories")
    .update(update)
    .eq("name", name)
    .eq("active", true)
    .select("*")
    .maybeSingle()
  handle(error)
  if (!data) throw new Error(`No active memory named "${name}" to update`)
  return data as MemoryRow
}

export async function deleteMemory(name: string): Promise<void> {
  assertPersonalName(name)
  const c = client()
  const { error } = await c
    .from("chat_memories")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("name", name)
    .eq("active", true)
  handle(error)
}

// ── Site awareness upsert (used by refresh_awareness, deterministic) ──────
export interface SiteAwarenessInput {
  category: string // blog | shelf | vault | tools | code
  description: string
  content: string
  keys: string[] // current item keys; diffed vs stored to compute deltas
  fingerprint: string
}

export async function upsertSiteAwareness(input: SiteAwarenessInput): Promise<{
  row: MemoryRow
  changed: boolean
  added: string[]
  removed: string[]
}> {
  if (!isValidName(`site:${input.category}`)) {
    throw new Error(`Invalid site category: ${input.category}`)
  }
  const name = `site:${input.category}`
  const c = client()
  const { data: existing } = await c
    .from("chat_memories")
    .select("*")
    .eq("name", name)
    .eq("active", true)
    .maybeSingle()
  const prev = existing as MemoryRow | null
  const oldKeys = prev?.links ?? []
  const added = input.keys.filter((k) => !oldKeys.includes(k))
  const removed = oldKeys.filter((k) => !input.keys.includes(k))
  const changed = !prev || prev.fingerprint !== input.fingerprint

  const now = new Date().toISOString()
  const contentWithDelta =
    added.length || removed.length
      ? `${input.content}\n\n## Recent changes\n${
          added.length ? `+ Added: ${added.join(", ")}\n` : ""
        }${removed.length ? `- Removed: ${removed.join(", ")}\n` : ""}`.trim()
      : input.content

  const row = {
    type: "site" as MemoryType,
    name,
    description: input.description,
    content: changed ? contentWithDelta : prev?.content ?? contentWithDelta,
    links: input.keys,
    fingerprint: input.fingerprint,
    last_used_at: now,
    last_synced_at: now,
    updated_at: now,
    active: true,
  }

  if (prev) {
    const { data, error } = await c
      .from("chat_memories")
      .update(row)
      .eq("id", prev.id)
      .select("*")
      .single()
    handle(error)
    return { row: data as MemoryRow, changed, added, removed }
  }
  const { data, error } = await c
    .from("chat_memories")
    .insert(row)
    .select("*")
    .single()
  handle(error)
  return { row: data as MemoryRow, changed, added, removed }
}

export async function getSiteAwareness(
  category: string
): Promise<MemoryRow | null> {
  const c = client()
  const { data, error } = await c
    .from("chat_memories")
    .select("*")
    .eq("name", `site:${category}`)
    .eq("active", true)
    .maybeSingle()
  handle(error)
  return (data as MemoryRow | null) ?? null
}

// ── Threads + messages ───────────────────────────────────────────────────
export async function createThread(
  title = "New conversation",
  modelPreference?: ModelPreference
): Promise<ChatThread> {
  const c = client()
  const insert: Record<string, unknown> = { title }
  if (modelPreference) insert.model_preference = modelPreference
  const { data, error } = await c
    .from("chat_threads")
    .insert(insert)
    .select("*")
    .single()
  handle(error)
  return data as ChatThread
}

export async function getThread(id: string): Promise<ChatThread | null> {
  const c = client()
  const { data, error } = await c
    .from("chat_threads")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  handle(error)
  return (data as ChatThread | null) ?? null
}

export async function listThreads(limit = 50): Promise<ChatThread[]> {
  const c = client()
  const { data, error } = await c
    .from("chat_threads")
    .select("*")
    .eq("purpose", "chat")
    .order("updated_at", { ascending: false })
    .limit(limit)
  handle(error)
  return (data ?? []) as ChatThread[]
}

export async function renameThread(id: string, title: string): Promise<void> {
  const c = client()
  const { error } = await c
    .from("chat_threads")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id)
  handle(error)
}

export async function touchThread(id: string): Promise<void> {
  const c = client()
  const { error } = await c
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id)
  handle(error)
}

export async function setThreadModelPreference(
  threadId: string,
  preference: ModelPreference
): Promise<void> {
  const c = client()
  const { error } = await c
    .from("chat_threads")
    .update({ model_preference: preference, updated_at: new Date().toISOString() })
    .eq("id", threadId)
  handle(error)
}

export async function setOneTurnOverride(
  threadId: string,
  tier: ModelTier
): Promise<void> {
  const c = client()
  const { error } = await c
    .from("chat_threads")
    .update({ one_turn_override: tier, updated_at: new Date().toISOString() })
    .eq("id", threadId)
  handle(error)
}

/** Read the one-turn override (if any) and clear it, atomically for this turn. */
export async function consumeOneTurnOverride(threadId: string): Promise<ModelTier | null> {
  const c = client()
  const { data, error } = await c
    .from("chat_threads")
    .select("one_turn_override")
    .eq("id", threadId)
    .maybeSingle()
  handle(error)
  const row = data as { one_turn_override: ModelTier | null } | null
  const tier = row?.one_turn_override ?? null
  if (tier) {
    const { error: e } = await c
      .from("chat_threads")
      .update({ one_turn_override: null, updated_at: new Date().toISOString() })
      .eq("id", threadId)
    handle(e)
  }
  return tier
}

export async function appendMessage(input: {
  threadId: string
  role: MessageRole
  content?: string | null
  toolCalls?: unknown
  model?: string | null
  reasoning?: string | null
  telemetry?: unknown
  webResearch?: unknown
}): Promise<ChatMessageRow> {
  const c = client()
  const { data, error } = await c
    .from("chat_messages")
    .insert({
      thread_id: input.threadId,
      role: input.role,
      content: input.content ?? null,
      tool_calls: input.toolCalls ?? null,
      model: input.model ?? null,
      reasoning: input.reasoning ?? null,
      telemetry: input.telemetry ?? null,
      web_research: input.webResearch ?? null,
    })
    .select("*")
    .single()
  handle(error)
  await touchThread(input.threadId)
  return data as ChatMessageRow
}

export async function getMessages(threadId: string): Promise<ChatMessageRow[]> {
  const c = client()
  const { data, error } = await c
    .from("chat_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
  handle(error)
  return (data ?? []) as ChatMessageRow[]
}

// ── Management UI helpers ────────────────────────────────────────────────
export async function listAllMemories(opts: {
  type?: MemoryType
  activeOnly?: boolean
} = {}): Promise<MemoryRow[]> {
  const c = client()
  let q = c.from("chat_memories").select("*")
  if (opts.type) q = q.eq("type", opts.type)
  if (opts.activeOnly) q = q.eq("active", true)
  q = q.order("type", { ascending: true }).order("updated_at", { ascending: false })
  const { data, error } = await q
  handle(error)
  return (data ?? []) as MemoryRow[]
}

export async function setMemoryActive(id: string, active: boolean): Promise<void> {
  const c = client()
  const { error } = await c
    .from("chat_memories")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
  handle(error)
}

export async function updateMemoryContent(
  id: string,
  patch: { content?: string; description?: string }
): Promise<void> {
  const c = client()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.content != null) update.content = patch.content
  if (patch.description != null) update.description = patch.description
  const { error } = await c.from("chat_memories").update(update).eq("id", id)
  handle(error)
}

export async function touchInferredAt(threadId: string): Promise<void> {
  const c = client()
  const { error } = await c
    .from("chat_threads")
    .update({ last_inferred_at: new Date().toISOString() })
    .eq("id", threadId)
  handle(error)
}

export async function listIdleUnprocessedThreads(opts: {
  idleMinutes: number
  limit: number
}): Promise<Pick<ChatThread, "id" | "title" | "updated_at" | "last_inferred_at">[]> {
  const cutoff = new Date(Date.now() - opts.idleMinutes * 60_000).toISOString()
  const c = client()
  const { data, error } = await c
    .from("chat_threads")
    .select("id,title,updated_at,last_inferred_at")
    .eq("purpose", "chat")
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: false })
    .limit(opts.limit)
  handle(error)
  const rows = (data ?? []) as Array<
    Pick<ChatThread, "id" | "title" | "updated_at" | "last_inferred_at">
  >
  return rows.filter((r) => {
    if (!r.last_inferred_at) return true
    return new Date(r.last_inferred_at) < new Date(r.updated_at)
  })
}

// ── Purpose-specific thread helpers (companion feature 2/3) ───────────────
// Companion threads are discriminated by purpose = 'blog-companion' and
// keyed by stable subject (post.id or "draft:<uuid>"). These helpers keep
// the discriminator checks in one place so chat and companion cannot leak
// into each other.

export async function getChatThread(id: string): Promise<ChatThread | null> {
  const c = client()
  const { data, error } = await c
    .from("chat_threads")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  handle(error)
  const row = (data as ChatThread | null) ?? null
  if (!row || row.purpose !== "chat") return null
  return row
}

export async function getCompanionThread(
  id: string,
  opts: { subjectType: string; subjectKey: string }
): Promise<ChatThread | null> {
  const c = client()
  const { data, error } = await c
    .from("chat_threads")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  handle(error)
  const row = (data as ChatThread | null) ?? null
  if (!row || row.purpose !== "blog-companion") return null
  if (row.subject_type !== opts.subjectType || row.subject_key !== opts.subjectKey) {
    return null
  }
  return row
}

export async function getOrCreateCompanionThread(opts: {
  subjectType: "post" | "draft"
  subjectKey: string
}): Promise<ChatThread> {
  const c = client()
  // 1) Try to find an existing companion thread for this subject.
  const { data: existing, error: qErr } = await c
    .from("chat_threads")
    .select("*")
    .eq("purpose", "blog-companion")
    .eq("subject_type", opts.subjectType)
    .eq("subject_key", opts.subjectKey)
    .maybeSingle()
  handle(qErr)
  if (existing) return existing as ChatThread

  // 2) None found — insert. Two concurrent first-turns can both reach here;
  //    the unique partial index uniq_companion_thread_subject arbitrates.
  const now = new Date().toISOString()
  const row = {
    title: `Companion: ${opts.subjectType} ${opts.subjectKey}`,
    purpose: "blog-companion",
    subject_type: opts.subjectType,
    subject_key: opts.subjectKey,
    updated_at: now,
  }
  const { data: inserted, error: insErr } = await c
    .from("chat_threads")
    .insert(row)
    .select("*")
    .single()
  if (insErr) {
    // Concurrent insert raced us — reselect the winner.
    const { data: raced, error: rErr } = await c
      .from("chat_threads")
      .select("*")
      .eq("purpose", "blog-companion")
      .eq("subject_type", opts.subjectType)
      .eq("subject_key", opts.subjectKey)
      .maybeSingle()
    handle(rErr)
    if (!raced) throw new Error(`Companion thread insert failed: ${insErr.message}`)
    return raced as ChatThread
  }
  return inserted as ChatThread
}

export async function listChatThreads(limit = 50): Promise<ChatThread[]> {
  return listThreads(limit)
}

export async function listIdleChatThreads(opts: {
  idleMinutes: number
  limit: number
}): Promise<Pick<ChatThread, "id" | "title" | "updated_at" | "last_inferred_at">[]> {
  return listIdleUnprocessedThreads(opts)
}