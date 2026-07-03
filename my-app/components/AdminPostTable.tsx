"use client"

import Link from "next/link"
import { useTransition } from "react"
import { Post, PostStatus } from "@/lib/db/posts"
import { deletePostAction } from "@/app/admin/blog/actions"

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function statusClass(status: PostStatus): string {
  switch (status) {
    case "published":
      return "pill live"
    case "archived":
      return "pill local"
    default:
      return "pill wip"
  }
}

export default function AdminPostTable({ posts }: { posts: Post[] }) {
  const [isPending, startTransition] = useTransition()

  function handleDelete(id: string) {
    if (!confirm("Delete this post? This cannot be undone.")) return
    startTransition(async () => {
      const result = await deletePostAction(id)
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
            <th className="text-left py-3 px-2">Title</th>
            <th className="text-left py-3 px-2">Slug</th>
            <th className="text-left py-3 px-2">Status</th>
            <th className="text-left py-3 px-2">Published</th>
            <th className="text-left py-3 px-2">Updated</th>
            <th className="text-right py-3 px-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <tr
              key={post.id}
              style={{ borderBottom: "1px dashed var(--line)" }}
            >
              <td className="py-3 px-2">
                <Link
                  href={`/admin/blog/edit/${post.slug}`}
                  className="open-link"
                >
                  {post.title}
                </Link>
              </td>
              <td className="py-3 px-2" style={{ color: "var(--walnut-soft)" }}>
                {post.slug}
              </td>
              <td className="py-3 px-2">
                <span className={statusClass(post.status)}>{post.status}</span>
              </td>
              <td className="py-3 px-2" style={{ color: "var(--walnut-soft)" }}>
                {formatDate(post.published_at)}
              </td>
              <td className="py-3 px-2" style={{ color: "var(--walnut-soft)" }}>
                {formatDate(post.updated_at)}
              </td>
              <td className="py-3 px-2 text-right">
                <Link
                  href={`/admin/blog/edit/${post.slug}`}
                  className="open-link mr-3"
                >
                  edit
                </Link>
                <Link
                  href={`/blog/${post.slug}`}
                  target="_blank"
                  rel="noopener"
                  className="open-link mr-3"
                >
                  view
                </Link>
                <button
                  onClick={() => handleDelete(post.id)}
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
