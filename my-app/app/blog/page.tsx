import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import Header from "@/components/Header"
import Footer from "@/components/Footer"
import PostCard from "@/components/PostCard"
import Pagination from "@/components/Pagination"
import { BLOG_CATEGORIES } from "@/lib/categories"
import { getPosts } from "@/lib/db/posts"

const PAGE_SIZE = 10

export const metadata: Metadata = {
  title: "Notes from the workshop — Pingusama's Tinkering",
  description: "A quiet feed of notes, updates, and makings from the workshop.",
}

type BlogPageProps = {
  searchParams: Promise<{ page?: string }>
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const { page: pageParam } = await searchParams
  const page = Math.max(1, Number(pageParam ?? "1") || 1)
  const limit = PAGE_SIZE
  const offset = (page - 1) * limit

  const [posts, allPosts] = await Promise.all([
    getPosts({
      status: "published",
      limit,
      offset,
    }),
    getPosts({ status: "published" }),
  ])

  if (!posts.length && page > 1) {
    notFound()
  }

  const totalPages = Math.max(1, Math.ceil(allPosts.length / limit))

  return (
    <>
      <Header />
      <main className="wrap py-8">
        <section className="mb-8 text-center">
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
            Notes from the workshop
          </h1>
          <p
            style={{
              maxWidth: 520,
              margin: "0 auto 18px",
              color: "var(--walnut-soft)",
              fontSize: "clamp(15px, 1.6vw, 17px)",
            }}
          >
            A quiet feed of notes, updates, and makings.
          </p>

          <div className="flex flex-wrap justify-center gap-2" style={{ maxWidth: 640, margin: "0 auto" }}>
            {BLOG_CATEGORIES.map((category) => (
              <Link
                key={category}
                href={`/blog/category/${encodeURIComponent(category)}`}
                className="pill"
              >
                {category}
              </Link>
            ))}
          </div>
        </section>

        {posts.length === 0 && page === 1 ? (
          <div className="detail">
            <p className="detail-desc">
              Nothing published yet. Check back as the workshop fills up.
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
              basePath="/blog"
            />
          </>
        )}
      </main>
      <Footer />
    </>
  )
}
