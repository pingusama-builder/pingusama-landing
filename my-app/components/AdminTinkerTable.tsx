"use client"

import Link from "next/link"
import { useTransition } from "react"
import { TinkerEntry, TinkerStatus } from "@/lib/db/tinker"
import { deleteTinkerEntryAction } from "@/app/admin/tinker/actions"

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function statusClass(status: TinkerStatus): string {
  switch (status) {
    case "published":
      return "pill live"
    case "archived":
      return "pill local"
    default:
      return "pill wip"
  }
}

export default function AdminTinkerTable({
  entries,
}: {
  entries: TinkerEntry[]
}) {
  const [isPending, startTransition] = useTransition()

  function handleDelete(id: string) {
    if (!confirm("Delete this 燈工房 entry? This cannot be undone.")) return
    startTransition(async () => {
      const result = await deleteTinkerEntryAction(id)
      if (!result.success) {
        alert(result.error)
      }
    })
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: 640 }}>
        <thead>
          <tr style={{ borderBottom: "1.5px solid var(--line)" }}>
            <th className="text-left py-3 px-2">主題</th>
            <th className="text-left py-3 px-2">Slug</th>
            <th className="text-left py-3 px-2">項目</th>
            <th className="text-left py-3 px-2">Status</th>
            <th className="text-left py-3 px-2">Updated</th>
            <th className="text-right py-3 px-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              style={{ borderBottom: "1px dashed var(--line)" }}
            >
              <td className="py-3 px-2">
                <Link
                  href={`/admin/tinker/edit/${entry.slug}`}
                  className="open-link"
                >
                  {entry.topic}
                </Link>
              </td>
              <td className="py-3 px-2" style={{ color: "var(--walnut-soft)" }}>
                {entry.slug}
              </td>
              <td className="py-3 px-2" style={{ color: "var(--walnut-soft)" }}>
                {entry.project ?? "—"}
              </td>
              <td className="py-3 px-2">
                <span className={statusClass(entry.status)}>{entry.status}</span>
              </td>
              <td className="py-3 px-2" style={{ color: "var(--walnut-soft)" }}>
                {formatDate(entry.updated_at)}
              </td>
              <td className="py-3 px-2 text-right">
                <Link
                  href={`/admin/tinker/edit/${entry.slug}`}
                  className="open-link mr-3"
                >
                  edit
                </Link>
                <Link
                  href="/portrait/tinker"
                  target="_blank"
                  rel="noopener"
                  className="open-link mr-3"
                >
                  view
                </Link>
                <button
                  onClick={() => handleDelete(entry.id)}
                  disabled={isPending}
                  className="open-link"
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--terracotta-d)",
                  }}
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}