import { createClient } from "@/lib/supabase/client"

const BUCKET = "blog-assets"
const MAX_SIZE_MB = 2
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.\-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export type UploadResult =
  | { success: true; publicUrl: string }
  | { success: false; error: string }

export async function uploadBlogImage(file: File): Promise<UploadResult> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      success: false,
      error: `Unsupported file type: ${file.type}. Use JPEG, PNG, WebP, or GIF.`,
    }
  }

  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return {
      success: false,
      error: `File too large: ${(file.size / 1024 / 1024).toFixed(
        2,
      )}MB. Max is ${MAX_SIZE_MB}MB.`,
    }
  }

  const safeName = sanitizeFilename(file.name) || "image"
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  const path = `covers/${timestamp}-${random}-${safeName}`

  const supabase = createClient()

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    })

  if (error || !data?.path) {
    return {
      success: false,
      error: error?.message || "Upload failed. Please try again.",
    }
  }

  const { data: publicUrlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(data.path)

  return { success: true, publicUrl: publicUrlData.publicUrl }
}

export function getImageExtensionFromType(type: string): string {
  switch (type) {
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    case "image/gif":
      return "gif"
    default:
      return "jpg"
  }
}

// ── 燈工房 source uploads ──────────────────────────────────────────────
// Reuses the blog-assets bucket (same public-read flag, same authenticated
// upload policies) under a `tinker/` prefix — no new bucket, no new policy.
// Unlike uploadBlogImage, this accepts TEXT (transcripts, notes, prompts):
// .md / .txt / .markdown / .json / .csv. The bucket's RLS policies don't
// restrict mime (only the client-side allow-list does), so a text upload is
// authorised by the existing "Authenticated upload for blog-assets" policy.

const TINKER_MAX_SIZE_MB = 5
const TINKER_ALLOWED_TYPES = [
  "text/markdown",
  "text/plain",
  "application/json",
  "text/csv",
]

// Suffixes we trust when the browser reports a generic type. Lets a .md file
// that arrives as application/octet-stream through — but ONLY if the suffix
// is on this list, so an .exe reporting octet-stream is still rejected.
const TINKER_ALLOWED_SUFFIXES = [".md", ".markdown", ".txt", ".json", ".csv"]

export function validateTinkerSource(file: File):
  | { ok: true }
  | { ok: false; error: string } {
  const lowerName = file.name.toLowerCase()
  const suffixOk = TINKER_ALLOWED_SUFFIXES.some((s) => lowerName.endsWith(s))
  if (!TINKER_ALLOWED_TYPES.includes(file.type) && !suffixOk) {
    return {
      ok: false,
      error: `Unsupported file type: ${file.type || "unknown"}. Use .md, .txt, .json, or .csv.`,
    }
  }
  if (file.size > TINKER_MAX_SIZE_MB * 1024 * 1024) {
    return {
      ok: false,
      error: `File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Max is ${TINKER_MAX_SIZE_MB}MB.`,
    }
  }
  return { ok: true }
}

export async function uploadTinkerSource(file: File): Promise<UploadResult> {
  const check = validateTinkerSource(file)
  if (!check.ok) {
    return { success: false, error: check.error }
  }

  const safeName = sanitizeFilename(file.name) || "source"
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  const path = `tinker/${timestamp}-${random}-${safeName}`

  const supabase = createClient()

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    })

  if (error || !data?.path) {
    return {
      success: false,
      error: error?.message || "Upload failed. Please try again.",
    }
  }

  const { data: publicUrlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(data.path)

  return { success: true, publicUrl: publicUrlData.publicUrl }
}
