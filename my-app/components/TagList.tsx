import Link from "next/link"
import { sanitizeSlug } from "@/lib/slug"

type TagListProps = {
  tags: string[]
  className?: string
}

export default function TagList({ tags, className }: TagListProps) {
  if (tags.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
      {tags.map((tag) => (
        <Link
          key={tag}
          href={`/blog/tag/${sanitizeSlug(tag)}`}
          className="pill"
          style={{
            borderColor: "var(--sage)",
            color: "var(--sage-deep)",
            background: "#EAF1DE",
          }}
        >
          {tag}
        </Link>
      ))}
    </div>
  )
}
