"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import {
  createPost,
  updatePost,
  deletePost,
  getPosts,
  getPostBySlug,
  parseAndPreparePost,
  Post,
  PostStatus,
} from "@/lib/db/posts"
import { generateSlug } from "@/lib/slug"

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/admin/login")
}

export async function getAdminPosts(
  options: { status?: PostStatus; limit?: number; offset?: number } = {}
): Promise<Post[]> {
  return getPosts({ ...options, limit: options.limit ?? 100 })
}

export async function getAdminPostBySlug(slug: string): Promise<Post | null> {
  return getPostBySlug(slug)
}

export type PostFormData = {
  title: string
  slug: string
  content_markdown: string
  excerpt?: string
  category?: string
  tags?: string
  status: PostStatus
  published_at?: string
  cover_image_url?: string
  meta_description?: string
}

function parseTags(tagsString?: string): string[] | null {
  if (!tagsString || tagsString.trim() === "") return null
  const tags = tagsString
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
  return tags.length > 0 ? tags : null
}

export async function savePostAction(
  formData: PostFormData,
  existingId?: string
): Promise<{ success: true; post: Post } | { success: false; error: string }> {
  try {
    const prepared = await parseAndPreparePost(formData.content_markdown, {
      title: formData.title,
      excerpt: formData.excerpt,
      category: formData.category || null,
      tags: parseTags(formData.tags),
      status: formData.status,
      published_at: formData.published_at
        ? new Date(formData.published_at).toISOString()
        : null,
      cover_image_url: formData.cover_image_url || null,
      meta_description: formData.meta_description || null,
    })

    let slug = formData.slug.trim()
    if (!slug) {
      const existingSlugs = existingId
        ? []
        : (await getPosts({ limit: 1000 })).map((post) => post.slug)
      slug = generateSlug(formData.title, existingSlugs)
    }

    const payload = {
      ...prepared,
      slug,
    }

    let post: Post

    if (existingId) {
      post = await updatePost(existingId, payload)
    } else {
      post = await createPost(payload)
    }

    revalidatePath("/blog")
    revalidatePath(`/blog/${post.slug}`)
    revalidatePath("/admin/blog")

    return { success: true, post }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save post"
    return { success: false, error: message }
  }
}

export async function deletePostAction(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await deletePost(id)
    revalidatePath("/blog")
    revalidatePath("/admin/blog")
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete post"
    return { success: false, error: message }
  }
}
