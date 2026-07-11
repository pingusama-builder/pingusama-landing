import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth"
import { getAdminPostBySlug } from "@/app/admin/blog/actions"
import AdminHeader from "@/components/AdminHeader"
import PostEditor from "@/components/PostEditor"
import Footer from "@/components/Footer"

type EditPageProps = {
  params: Promise<{ slug: string }>
}

export default async function EditPostPage({ params }: EditPageProps) {
  await requireAdmin()
  const { slug } = await params
  const post = await getAdminPostBySlug(slug)

  if (!post) {
    notFound()
  }

  return (
    <>
      <AdminHeader />
      <main className="editor-wrap py-8">
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
            Edit post
          </h1>
        </div>

        <PostEditor post={post} />
      </main>
      <Footer />
    </>
  )
}
