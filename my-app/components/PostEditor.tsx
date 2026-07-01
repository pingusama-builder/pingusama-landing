"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Post, PostStatus } from "@/lib/db/posts"
import { PostFormData, savePostAction } from "@/app/admin/blog/actions"
import { previewMarkdown } from "@/app/admin/blog/preview"
import PostBody from "./PostBody"

const EMPTY_FORM: PostFormData = {
  title: "",
  slug: "",
  content_markdown: "",
  excerpt: "",
  category: "",
  tags: "",
  status: "draft",
  published_at: "",
  cover_image_url: "",
  meta_description: "",
}

function postToFormData(post: Post): PostFormData {
  return {
    title: post.title,
    slug: post.slug,
    content_markdown: post.content_markdown,
    excerpt: post.excerpt ?? "",
    category: post.category ?? "",
    tags: post.tags?.join(", ") ?? "",
    status: post.status,
    published_at: post.published_at
      ? new Date(post.published_at).toISOString().slice(0, 16)
      : "",
    cover_image_url: post.cover_image_url ?? "",
    meta_description: post.meta_description ?? "",
  }
}

type ToolbarAction = {
  label: string
  prefix: string
  suffix: string
  defaultText: string
  block?: boolean
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  { label: "B", prefix: "**", suffix: "**", defaultText: "bold text" },
  { label: "I", prefix: "_", suffix: "_", defaultText: "italic text" },
  { label: "H2", prefix: "## ", suffix: "", defaultText: "Heading", block: true },
  { label: "Link", prefix: "[", suffix: "](https://example.com)", defaultText: "link text" },
  { label: "List", prefix: "- ", suffix: "", defaultText: "list item", block: true },
  { label: "Number", prefix: "1. ", suffix: "", defaultText: "list item", block: true },
  { label: "Quote", prefix: "> ", suffix: "", defaultText: "quoted text", block: true },
  { label: "Code", prefix: "```\n", suffix: "\n```", defaultText: "code" },
]

export default function PostEditor({
  post,
}: {
  post?: Post
}) {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [form, setForm] = useState(post ? postToFormData(post) : EMPTY_FORM)
  const [previewHtml, setPreviewHtml] = useState("")
  const [showPreview, setShowPreview] = useState(false)
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()

  function updateField(field: keyof PostFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function applyMarkdown(action: ToolbarAction) {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart ?? 0
    const end = textarea.selectionEnd ?? 0
    const value = form.content_markdown
    const selected = value.slice(start, end)
    const before = value.slice(0, start)
    const after = value.slice(end)

    let replacement: string
    let newCursorStart: number
    let newCursorEnd: number

    if (selected) {
      if (action.block) {
        // Insert block prefix at the start of each selected line
        const lines = selected.split("\n")
        const prefixed = lines.map((line) => action.prefix + line).join("\n")
        replacement = prefixed
        newCursorStart = start
        newCursorEnd = start + replacement.length
      } else {
        replacement = action.prefix + selected + action.suffix
        newCursorStart = start
        newCursorEnd = start + replacement.length
      }
    } else {
      replacement = action.prefix + action.defaultText + action.suffix
      newCursorStart = start + action.prefix.length
      newCursorEnd = newCursorStart + action.defaultText.length
    }

    const nextValue = before + replacement + after
    updateField("content_markdown", nextValue)

    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(newCursorStart, newCursorEnd)
    })
  }

  async function handlePreview() {
    const html = await previewMarkdown(form.content_markdown)
    setPreviewHtml(html)
    setShowPreview(true)
  }

  function handleSubmit(statusOverride?: PostStatus) {
    startTransition(async () => {
      const data = {
        ...form,
        status: statusOverride ?? form.status,
        published_at:
          statusOverride === "published" && !form.published_at
            ? new Date().toISOString().slice(0, 16)
            : form.published_at,
      }

      const result = await savePostAction(data, post?.id)

      if (!result.success) {
        setError(result.error)
        return
      }

      router.push("/admin/blog")
    })
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
      className="flex flex-col gap-4"
    >
      {error && (
        <div className="detail" style={{ borderColor: "var(--terracotta)" }}>
          <p className="detail-desc" style={{ color: "var(--terracotta-d)" }}>
            {error}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="title" className="text-sm font-semibold">
            Title
          </label>
          <input
            id="title"
            type="text"
            value={form.title}
            onChange={(event) => updateField("title", event.target.value)}
            required
            className="px-3 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="slug" className="text-sm font-semibold">
            Slug
          </label>
          <input
            id="slug"
            type="text"
            value={form.slug}
            onChange={(event) => updateField("slug", event.target.value)}
            placeholder="leave blank to auto-generate from title"
            className="px-3 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] placeholder:text-[var(--walnut-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="category" className="text-sm font-semibold">
            Category
          </label>
          <input
            id="category"
            type="text"
            value={form.category}
            onChange={(event) => updateField("category", event.target.value)}
            className="px-3 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="tags" className="text-sm font-semibold">
            Tags
          </label>
          <input
            id="tags"
            type="text"
            value={form.tags}
            onChange={(event) => updateField("tags", event.target.value)}
            placeholder="comma, separated"
            className="px-3 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] placeholder:text-[var(--walnut-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-sm font-semibold">
            Status
          </label>
          <select
            id="status"
            value={form.status}
            onChange={(event) => updateField("status", event.target.value)}
            className="px-3 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
          >
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="published_at" className="text-sm font-semibold">
            Publish date
          </label>
          <input
            id="published_at"
            type="datetime-local"
            value={form.published_at}
            onChange={(event) => updateField("published_at", event.target.value)}
            className="px-3 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="cover_image_url" className="text-sm font-semibold">
            Cover image URL
          </label>
          <input
            id="cover_image_url"
            type="url"
            value={form.cover_image_url}
            onChange={(event) => updateField("cover_image_url", event.target.value)}
            placeholder="https://..."
            className="px-3 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] placeholder:text-[var(--walnut-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="excerpt" className="text-sm font-semibold">
          Excerpt
        </label>
        <textarea
          id="excerpt"
          value={form.excerpt}
          onChange={(event) => updateField("excerpt", event.target.value)}
          rows={2}
          placeholder="Leave blank to auto-generate from the first paragraph"
          className="px-3 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] placeholder:text-[var(--walnut-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="meta_description" className="text-sm font-semibold">
          Meta description
        </label>
        <textarea
          id="meta_description"
          value={form.meta_description}
          onChange={(event) => updateField("meta_description", event.target.value)}
          rows={2}
          className="px-3 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="content_markdown" className="text-sm font-semibold">
          Markdown body
        </label>
        <div className="flex flex-wrap gap-1 rounded-t-[var(--radius)] border border-[var(--line)] border-b-0 bg-[var(--bg-card)] p-1">
          {TOOLBAR_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => applyMarkdown(action)}
              disabled={isPending}
              className="px-2 py-1 text-xs font-semibold rounded hover:bg-[var(--line)] text-[var(--walnut)] disabled:opacity-50"
              title={action.label}
            >
              {action.label}
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          id="content_markdown"
          value={form.content_markdown}
          onChange={(event) => updateField("content_markdown", event.target.value)}
          rows={16}
          required
          className="px-3 py-2 rounded-b-[var(--radius)] rounded-t-none border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => handleSubmit("draft")}
          disabled={isPending}
          className="pill cursor-pointer"
        >
          {isPending ? "Saving..." : "Save draft"}
        </button>

        <button
          type="button"
          onClick={() => handleSubmit("published")}
          disabled={isPending}
          className="pill live cursor-pointer"
        >
          {isPending ? "Publishing..." : "Publish"}
        </button>

        <button
          type="button"
          onClick={handlePreview}
          disabled={isPending}
          className="pill cursor-pointer"
        >
          Preview
        </button>
      </div>

      {showPreview && (
        <div className="detail mt-4">
          <p className="detail-eyebrow mb-2">Preview</p>
          <PostBody html={previewHtml} />
        </div>
      )}
    </form>
  )
}
