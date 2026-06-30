import Header from "@/components/Header"
import Footer from "@/components/Footer"
import PostCard from "@/components/PostCard"
import Pagination from "@/components/Pagination"
import { getPosts } from "@/lib/db/posts"
import type { Metadata } from "next"

type TagPageProps = {
  params: Promise<{ tag: string }>
  searchParams: Promise<{ page?: string }>
}

export async function generateMetadata({
  params,
}: TagPageProps): Promise<Metadata> {
  const { tag } = await params
  const decodedTag = decodeURIComponent(tag)
  return {
    title: `${decodedTag} — Tag — Pingusama's Tinkering`,
  }
}

export default async function TagPage({
  params,
  searchParams,
}: TagPageProps) {
  const { tag } = await params
  const { page: pageParam } = await searchParams
  const decodedTag = decodeURIComponent(tag)
  const page = Math.max(1, Number(pageParam ?? "1") || 1)
  const limit = 10
  const offset = (page - 1) * limit

  const [posts, allPosts] = await Promise.all([
    getPosts({
      status: "published",
      tag: decodedTag,
      limit,
      offset,
    }),
    getPosts({ status: "published", tag: decodedTag }),
  ])

  const totalPages = Math.max(1, Math.ceil(allPosts.length / limit))

  return (
    <>
      <Header />
      <main className="wrap py-8">
        <section className="mb-8 text-left">
          <p className="eyebrow">from the workshop</p>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "clamp(34px, 5.4vw, 52px)",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: "0 0 10px",
              color: "var(--walnut)",
            }}
          >
            Tag: {decodedTag}
          </h1>
        </section>

        {posts.length === 0 && page === 1 ? (
          <div className="detail">
            <p className="detail-desc">
              No posts found tagged with{" "}
              <strong>{decodedTag}</strong> yet. Check back as the workshop
              grows.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-6">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              basePath={`/blog/tag/${encodeURIComponent(decodedTag)}`}
            />
          </>
        )}
      </main>
      <Footer />
    </>
  )
}
