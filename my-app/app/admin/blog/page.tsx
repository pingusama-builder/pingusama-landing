import Link from "next/link"
import { requireAdmin } from "@/lib/auth"
import { getAdminPosts } from "./actions"
import AdminHeader from "@/components/AdminHeader"
import AdminPostTable from "@/components/AdminPostTable"
import Footer from "@/components/Footer"

export default async function AdminDashboardPage() {
  await requireAdmin()
  const posts = await getAdminPosts({ limit: 100 })

  return (
    <>
      <AdminHeader />
      <main className="wrap py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="eyebrow">workshop admin</p>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: "clamp(28px, 4vw, 40px)",
                color: "var(--walnut)",
              }}
            >
              Posts
            </h1>
          </div>
          <Link href="/admin/blog/new" className="pill live">
            New post
          </Link>
        </div>

        {posts.length === 0 ? (
          <div className="detail">
            <p className="detail-desc">
              No posts yet.{" "}
              <Link href="/admin/blog/new" className="open-link">
                Write the first one
              </Link>
              .
            </p>
          </div>
        ) : (
          <AdminPostTable posts={posts} />
        )}
      </main>
      <Footer />
    </>
  )
}
