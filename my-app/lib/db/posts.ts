import { createServiceClient } from "@/lib/supabase/server"
import { parseMarkdown } from "@/lib/markdown"

export type PostStatus = "draft" | "published" | "archived"

export interface Post {
  id: string
  slug: string
  title: string
  excerpt: string | null
  content_markdown: string
  content_html: string
  category: string | null
  tags: string[] | null
  status: PostStatus
  published_at: string | null
  updated_at: string
  created_at: string
  author_id: string | null
  cover_image_url: string | null
  meta_description: string | null
}

export type CreatePostInput = Omit<Post, "id" | "created_at" | "updated_at">

export type UpdatePostInput = Partial<
  Omit<Post, "id" | "created_at" | "updated_at">
>

function getClient() {
  return createServiceClient()
}

function handleError(error: { message: string } | null): void {
  if (error) {
    throw new Error(error.message)
  }
}

export async function getPosts(
  options: { status?: PostStatus; category?: string; tag?: string; limit?: number; offset?: number } = {},
): Promise<Post[]> {
  const client = getClient()
  let query = client.from("posts").select("*")

  if (options.status) {
    query = query.eq("status", options.status)
  }
  if (options.category) {
    query = query.eq("category", options.category)
  }
  if (options.tag) {
    query = query.contains("tags", [options.tag])
  }

  query = query.order("created_at", { ascending: false })

  if (typeof options.limit === "number") {
    const from = options.offset ?? 0
    query = query.range(from, from + options.limit - 1)
  }

  const { data, error } = await query
  handleError(error)

  return (data ?? []) as Post[]
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const client = getClient()
  const { data, error } = await client
    .from("posts")
    .select("*")
    .eq("slug", slug)
    .maybeSingle()

  handleError(error)
  return (data as Post | null) ?? null
}

export async function getPostById(id: string): Promise<Post | null> {
  const client = getClient()
  const { data, error } = await client
    .from("posts")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  handleError(error)
  return (data as Post | null) ?? null
}

export async function getPublishedPostBySlug(slug: string): Promise<Post | null> {
  const post = await getPostBySlug(slug)
  if (!post || post.status !== "published") {
    return null
  }
  return post
}

export async function createPost(input: CreatePostInput): Promise<Post> {
  if (!input.slug || !input.title || !input.content_markdown || !input.content_html) {
    throw new Error("Missing required post fields: slug, title, content_markdown, content_html")
  }

  const client = getClient()
  const { data, error } = await client
    .from("posts")
    .insert(input)
    .select()
    .single()

  handleError(error)
  if (!data) {
    throw new Error("Failed to create post: no data returned")
  }

  return data as Post
}

export async function updatePost(id: string, input: UpdatePostInput): Promise<Post> {
  const client = getClient()
  const { data, error } = await client
    .from("posts")
    .update(input)
    .eq("id", id)
    .select()
    .single()

  handleError(error)
  if (!data) {
    throw new Error("Failed to update post: no data returned")
  }

  return data as Post
}

export async function deletePost(id: string): Promise<void> {
  const client = getClient()
  const { error } = await client.from("posts").delete().eq("id", id)
  handleError(error)
}

export async function searchPosts(query: string): Promise<Post[]> {
  const client = getClient()
  const { data, error } = await client.rpc("search_posts", { query_text: query })

  handleError(error)
  return (data ?? []) as Post[]
}

export async function parseAndPreparePost(
  markdownSource: string,
  overrides: Partial<CreatePostInput> = {},
): Promise<
  Omit<CreatePostInput, "slug" | "title" | "content_markdown" | "content_html" | "excerpt"> & {
    title: string
    content_markdown: string
    content_html: string
    excerpt: string
  }
> {
  const { data, html, excerpt } = await parseMarkdown(markdownSource)

  return {
    title: overrides.title ?? (data.title as string) ?? "Untitled",
    content_markdown: markdownSource,
    content_html: html,
    excerpt: overrides.excerpt ?? excerpt ?? "",
    category: overrides.category ?? (data.category as string) ?? null,
    tags: overrides.tags ?? (data.tags as string[]) ?? null,
    status: overrides.status ?? (data.status as PostStatus) ?? "draft",
    published_at:
      overrides.published_at ??
      (data.published_at ? new Date(data.published_at as string).toISOString() : null),
    cover_image_url: overrides.cover_image_url ?? (data.cover_image_url as string) ?? null,
    meta_description: overrides.meta_description ?? (data.meta_description as string) ?? null,
    author_id: overrides.author_id ?? null,
  }
}
