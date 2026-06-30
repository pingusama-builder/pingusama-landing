import { requireAdmin } from "@/lib/auth"
import AdminHeader from "@/components/AdminHeader"
import PostEditor from "@/components/PostEditor"
import Footer from "@/components/Footer"

export default async function NewPostPage() {
  await requireAdmin()

  return (
    <>
      <AdminHeader />
      <main className="wrap py-8">
        <div className="mb-6">
          <p className="eyebrow">workshop admin</p>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "clamp(28px, 4vw, 40px)",
              color: "var(--walnut)",
            }}
          >
            New post
          </h1>
        </div>

        <PostEditor />
      </main>
      <Footer />
    </>
  )
}
