"use server"

import { revalidatePath } from "next/cache"
import {
  createTinkerEntry,
  updateTinkerEntry,
  deleteTinkerEntry,
  getTinkerEntries,
  getTinkerEntryBySlug,
  type TinkerEntry,
  type TinkerStatus,
  type TinkerSource,
} from "@/lib/db/tinker"
import { sanitizeSlug } from "@/lib/slug"

export async function getAdminTinkerEntries(
  options: { status?: TinkerStatus; limit?: number } = {},
): Promise<TinkerEntry[]> {
  return getTinkerEntries({ ...options, limit: options.limit ?? 100 })
}

export async function getAdminTinkerEntryBySlug(
  slug: string,
): Promise<TinkerEntry | null> {
  return getTinkerEntryBySlug(slug)
}

export type TinkerEntryFormData = {
  slug: string
  topic: string
  project: string
  harness: string
  prompt: string
  source: TinkerSource
  status: TinkerStatus
  sort_order: string
}

function resolveSlug(topic: string, slug: string, existingId?: string): string {
  let next = sanitizeSlug(slug.trim() || topic.trim())
  if (!next) {
    // Chinese/non-ASCII topics sanitize to empty — fall back to a short
    // timestamp slug so the UNIQUE constraint never forces a manual slug.
    next = `entry-${Date.now().toString(36)}`
  }
  return next
}

export async function saveTinkerEntryAction(
  formData: TinkerEntryFormData,
  existingId?: string,
): Promise<
  { success: true; entry: TinkerEntry } | { success: false; error: string }
> {
  try {
    const slug = resolveSlug(formData.topic, formData.slug, existingId)

    // Build a clean source object — drop empty keys so the jsonb stays tidy.
    const src = formData.source
    const source: TinkerSource = {}
    if (src.label?.trim()) source.label = src.label.trim()
    if (src.url?.trim()) source.url = src.url.trim()
    if (src.path?.trim()) source.path = src.path.trim()
    if (src.note?.trim()) source.note = src.note.trim()
    const sourceValue = Object.keys(source).length > 0 ? source : null

    const payload = {
      slug,
      topic: formData.topic.trim(),
      project: formData.project.trim() || null,
      harness: formData.harness.trim() || null,
      prompt: formData.prompt,
      source: sourceValue,
      status: formData.status,
      sort_order: Number.parseInt(formData.sort_order, 10) || 0,
    }

    let entry: TinkerEntry
    if (existingId) {
      entry = await updateTinkerEntry(existingId, payload)
    } else {
      entry = await createTinkerEntry(payload)
    }

    revalidatePath("/portrait/tinker")
    revalidatePath("/api/tinker-entries")
    revalidatePath("/admin/tinker")

    return { success: true, entry }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save tinker entry"
    return { success: false, error: message }
  }
}

export async function deleteTinkerEntryAction(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await deleteTinkerEntry(id)
    revalidatePath("/portrait/tinker")
    revalidatePath("/api/tinker-entries")
    revalidatePath("/admin/tinker")
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete tinker entry"
    return { success: false, error: message }
  }
}