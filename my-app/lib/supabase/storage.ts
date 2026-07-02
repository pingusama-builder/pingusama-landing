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
