import Header from "@/components/Header"
import Footer from "@/components/Footer"
import PostCard from "@/components/PostCard"
import SearchBox from "@/components/SearchBox"
import { searchPosts } from "@/lib/db/posts"
import type { Metadata } from "next"

type SearchPageProps = {
  searchParams: Promise<{ q?: string | string[] }>
}

export async function generateMetadata({
  searchParams,
}: SearchPageProps): Promise<Metadata> {
  const { q } = await searchParams
  const query = Array.isArray(q) ? q[0] : q
  return {
    title: query
      ? `Search: ${query} — Pingusama's Tinkering`
      : "Search — Pingusama's Tinkering",
  }
}

export default async function SearchPage({
  searchParams,
}: SearchPageProps) {
  const { q } = await searchParams
  const query = Array.isArray(q) ? q[0] : q
  const results = query ? await searchPosts(query) : []

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
            Search the workshop
          </h1>
        </section>

        <SearchBox initialQuery={query} />

        {results.length === 0 ? (
          <div className="detail">
            <p className="detail-desc">
              {query
                ? `No posts found for "${query}". Try a different word.`
                : "Enter a word above to search the workshop."}
            </p>
          </div>
        ) : (
          <>
            <p className="detail-eyebrow mb-4">
              {results.length} {results.length === 1 ? "result" : "results"}
              {query && ` for "${query}"`}
            </p>
            <div className="flex flex-col gap-6">
              {results.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  )
}
