import Link from "next/link"
import { Post } from "@/lib/db/posts"
import TagList from "./TagList"
import CoverImage from "./CoverImage"

type PostCardProps = {
  post: Post
}

export default function PostCard({ post }: PostCardProps) {
  const date = post.published_at ? new Date(post.published_at) : null

  return (
    <article className="detail">
      <CoverImage src={post.cover_image_url} label={post.title} />
      <div className="detail-head mt-3">
        <span className="detail-eyebrow">
          {post.category ?? "from the workshop"}
        </span>
        {date && (
          <time dateTime={date.toISOString()} className="pill">
            {date.toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </time>
        )}
      </div>
      <h2 className="detail-title">
        <Link href={`/blog/${post.slug}`} className="open-link">
          {post.title}
        </Link>
      </h2>
      {post.excerpt && <p className="detail-desc">{post.excerpt}</p>}
      {post.tags && post.tags.length > 0 && (
        <div className="detail-foot">
          <TagList tags={post.tags} />
        </div>
      )}
    </article>
  )
}
