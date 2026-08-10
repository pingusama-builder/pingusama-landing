"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { TinkerEntry, TinkerStatus, TinkerSource } from "@/lib/db/tinker"
import {
  TinkerEntryFormData,
  saveTinkerEntryAction,
} from "@/app/admin/tinker/actions"
import { uploadTinkerSource } from "@/lib/supabase/storage"

const EMPTY_FORM: TinkerEntryFormData = {
  slug: "",
  topic: "",
  project: "",
  harness: "",
  prompt: "",
  source: {},
  status: "published",
  sort_order: "0",
}

function entryToFormData(entry: TinkerEntry): TinkerEntryFormData {
  return {
    slug: entry.slug,
    topic: entry.topic,
    project: entry.project ?? "",
    harness: entry.harness ?? "",
    prompt: entry.prompt,
    source: entry.source ?? {},
    status: entry.status,
    sort_order: String(entry.sort_order ?? 0),
  }
}

export default function TinkerEditor({ entry }: { entry?: TinkerEntry }) {
  const router = useRouter()
  const [form, setForm] = useState(entry ? entryToFormData(entry) : EMPTY_FORM)
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function updateField<K extends keyof TinkerEntryFormData>(
    field: K,
    value: TinkerEntryFormData[K],
  ) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function updateSource<K extends keyof TinkerSource>(
    field: K,
    value: string,
  ) {
    setForm((prev) => ({ ...prev, source: { ...prev.source, [field]: value } }))
  }

  async function handleSourceUpload(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError("")

    const result = await uploadTinkerSource(file)

    setUploading(false)
    event.target.value = ""

    if (!result.success) {
      setError(result.error)
      return
    }

    // Stash the public URL + use the filename as the label if none set yet.
    setForm((prev) => ({
      ...prev,
      source: {
        ...prev.source,
        url: result.publicUrl,
        label: prev.source.label?.trim() || file.name,
      },
    }))
  }

  function handleSubmit(statusOverride?: TinkerStatus) {
    startTransition(async () => {
      const data = { ...form, status: statusOverride ?? form.status }
      const result = await saveTinkerEntryAction(data, entry?.id)
      if (!result.success) {
        setError(result.error)
        return
      }
      router.push("/admin/tinker")
    })
  }

  const inputCls =
    "px-3 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
      className="editor-main flex flex-col gap-4"
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
          <label htmlFor="topic" className="text-sm font-semibold">
            主題 topic <span style={{ color: "var(--terracotta)" }}>*</span>
          </label>
          <input
            id="topic"
            type="text"
            value={form.topic}
            onChange={(e) => updateField("topic", e.target.value)}
            required
            className={inputCls}
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
            onChange={(e) => updateField("slug", e.target.value)}
            placeholder="leave blank to auto-generate"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="project" className="text-sm font-semibold">
            項目名 project
          </label>
          <input
            id="project"
            type="text"
            value={form.project}
            onChange={(e) => updateField("project", e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="harness" className="text-sm font-semibold">
            model／harness
          </label>
          <input
            id="harness"
            type="text"
            value={form.harness}
            onChange={(e) => updateField("harness", e.target.value)}
            placeholder="e.g. glm 5.2 cloud · Claude Code via Ollama"
            className={inputCls}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="prompt" className="text-sm font-semibold">
          prompt <span style={{ color: "var(--terracotta)" }}>*</span>
        </label>
        <textarea
          id="prompt"
          value={form.prompt}
          onChange={(e) => updateField("prompt", e.target.value)}
          rows={8}
          required
          className={`${inputCls} font-mono text-sm`}
        />
      </div>

      <div className="detail flex flex-col gap-3">
        <p className="detail-eyebrow">來源 source（optional）</p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending || uploading}
            className="pill cursor-pointer"
          >
            {uploading ? "Uploading…" : "Upload file"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,.json,.csv,text/markdown,text/plain,application/json,text/csv"
            onChange={handleSourceUpload}
            className="hidden"
            aria-hidden="true"
          />
          <span className="text-xs text-[var(--walnut-soft)]">
            .md / .txt / .json / .csv — reuses the blog-assets bucket
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="src-label" className="text-xs font-semibold">
              Label
            </label>
            <input
              id="src-label"
              type="text"
              value={form.source.label ?? ""}
              onChange={(e) => updateSource("label", e.target.value)}
              placeholder="e.g. transcript.md · Q7"
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="src-url" className="text-xs font-semibold">
              URL (public link)
            </label>
            <input
              id="src-url"
              type="url"
              value={form.source.url ?? ""}
              onChange={(e) => updateSource("url", e.target.value)}
              placeholder="https://… (filled by upload)"
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="src-path" className="text-xs font-semibold">
            Path (local / repo reference)
          </label>
          <input
            id="src-path"
            type="text"
            value={form.source.path ?? ""}
            onChange={(e) => updateSource("path", e.target.value)}
            placeholder="D:\… or repo-relative path"
            className={inputCls}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="src-note" className="text-xs font-semibold">
            Note
          </label>
          <textarea
            id="src-note"
            value={form.source.note ?? ""}
            onChange={(e) => updateSource("note", e.target.value)}
            rows={2}
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-sm font-semibold">
            Status
          </label>
          <select
            id="status"
            value={form.status}
            onChange={(e) => updateField("status", e.target.value as TinkerStatus)}
            className={inputCls}
          >
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sort_order" className="text-sm font-semibold">
            Sort order
          </label>
          <input
            id="sort_order"
            type="number"
            value={form.sort_order}
            onChange={(e) => updateField("sort_order", e.target.value)}
            className={inputCls}
          />
        </div>
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
      </div>
    </form>
  )
}