import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Header from "@/components/Header"
import Footer from "@/components/Footer"
import PostBody from "@/components/PostBody"
import TagList from "@/components/TagList"
import { getPublishedPostBySlug } from "@/lib/db/posts"

export const revalidate = 60

type PostPageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: PostPageProps): Promise<Metadata> {
  const { slug } = await params
  const post = await getPublishedPostBySlug(slug)

  return {
    title: post
      ? `${post.title} — Pingusama's Tinkering`
      : "Not found — Pingusama's Tinkering",
    description: post?.meta_description ?? post?.excerpt ?? "A workshop note.",
  }
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params
  const post = await getPublishedPostBySlug(slug)

  if (!post) {
    notFound()
  }

  const date = post.published_at
    ? new Date(post.published_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null

  return (
    <>
      <Header />
      <main className="wrap py-8">
        <article className="detail" style={{ maxWidth: 720, margin: "0 auto" }}>
          <div className="detail-head">
            {post.category && <span className="pill">{post.category}</span>}
            {date && (
              <time
                dateTime={post.published_at ?? undefined}
                className="text-sm"
                style={{ color: "var(--walnut-soft)" }}
              >
                {date}
              </time>
            )}
          </div>

          <h1
            className="detail-title"
            style={{ textAlign: "left", marginBottom: 16 }}
          >
            {post.title}
          </h1>

          {post.cover_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.cover_image_url}
              alt=""
              style={{
                width: "100%",
                borderRadius: "var(--radius)",
                margin: "0 0 20px",
              }}
            />
          )}

          <PostBody html={post.content_html} />

          {post.tags && post.tags.length > 0 && (
            <div
              style={{
                marginTop: 28,
                paddingTop: 16,
                borderTop: "1px dashed var(--line)",
              }}
            >
              <TagList tags={post.tags} />
            </div>
          )}
        </article>
      </main>
      <Footer />
    </>
  )
}
