import { createServiceClient } from "@/lib/supabase/server"

// 燈工房 (tinker) — 靈氣 prompts trove. Mirrors lib/db/posts.ts: all access is
// service-role (bypasses RLS). Public reads happen via the /api/tinker-entries
// route which filters status='published' itself; the table's RLS also exposes
// only published to anon/authenticated as a defence-in-depth.

export type TinkerStatus = "draft" | "published" | "archived"

export interface TinkerSource {
  label?: string
  url?: string
  path?: string
  note?: string
}

export interface TinkerEntry {
  id: string
  slug: string
  topic: string
  project: string | null
  harness: string | null
  prompt: string
  source: TinkerSource | null
  status: TinkerStatus
  sort_order: number
  updated_at: string
  created_at: string
}

export type CreateTinkerEntryInput = Omit<
  TinkerEntry,
  "id" | "created_at" | "updated_at"
>

export type UpdateTinkerEntryInput = Partial<
  Omit<TinkerEntry, "id" | "created_at" | "updated_at">
>

function getClient() {
  return createServiceClient()
}

function handleError(error: { message: string } | null): void {
  if (error) {
    throw new Error(error.message)
  }
}

function normalizeRow(row: TinkerEntry | null): TinkerEntry | null {
  if (!row) return null
  // source is jsonb; normalise missing to null.
  return { ...row, source: (row.source as TinkerSource | null) ?? null }
}

export async function getPublishedTinkerEntries(): Promise<TinkerEntry[]> {
  const client = getClient()
  const { data, error } = await client
    .from("tinker_entries")
    .select("*")
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })

  handleError(error)
  return (data ?? []).map(normalizeRow) as TinkerEntry[]
}

export async function getTinkerEntries(
  options: { status?: TinkerStatus; limit?: number } = {},
): Promise<TinkerEntry[]> {
  const client = getClient()
  let query = client.from("tinker_entries").select("*")

  if (options.status) {
    query = query.eq("status", options.status)
  }

  query = query.order("sort_order", { ascending: true }).order("created_at", { ascending: false })

  if (typeof options.limit === "number") {
    query = query.range(0, options.limit - 1)
  }

  const { data, error } = await query
  handleError(error)
  return (data ?? []).map(normalizeRow) as TinkerEntry[]
}

export async function getTinkerEntryBySlug(slug: string): Promise<TinkerEntry | null> {
  const client = getClient()
  const { data, error } = await client
    .from("tinker_entries")
    .select("*")
    .eq("slug", slug)
    .maybeSingle()

  handleError(error)
  return normalizeRow((data as TinkerEntry | null) ?? null)
}

export async function getTinkerEntryById(id: string): Promise<TinkerEntry | null> {
  const client = getClient()
  const { data, error } = await client
    .from("tinker_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  handleError(error)
  return normalizeRow((data as TinkerEntry | null) ?? null)
}

export async function createTinkerEntry(
  input: CreateTinkerEntryInput,
): Promise<TinkerEntry> {
  if (!input.slug || !input.topic || !input.prompt) {
    throw new Error("Missing required tinker entry fields: slug, topic, prompt")
  }

  const client = getClient()
  const { data, error } = await client
    .from("tinker_entries")
    .insert(input)
    .select()
    .single()

  handleError(error)
  if (!data) {
    throw new Error("Failed to create tinker entry: no data returned")
  }
  return normalizeRow(data as TinkerEntry)!
}

export async function updateTinkerEntry(
  id: string,
  input: UpdateTinkerEntryInput,
): Promise<TinkerEntry> {
  const client = getClient()
  const { data, error } = await client
    .from("tinker_entries")
    .update(input)
    .eq("id", id)
    .select()
    .single()

  handleError(error)
  if (!data) {
    throw new Error("Failed to update tinker entry: no data returned")
  }
  return normalizeRow(data as TinkerEntry)!
}

export async function deleteTinkerEntry(id: string): Promise<void> {
  const client = getClient()
  const { error } = await client.from("tinker_entries").delete().eq("id", id)
  handleError(error)
}