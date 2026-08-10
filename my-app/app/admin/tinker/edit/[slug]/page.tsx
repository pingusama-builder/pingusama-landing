import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth"
import { getAdminTinkerEntryBySlug } from "../../actions"
import AdminHeader from "@/components/AdminHeader"
import TinkerEditor from "@/components/TinkerEditor"
import Footer from "@/components/Footer"

export default async function EditTinkerEntryPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  await requireAdmin()
  const { slug } = await params
  const entry = await getAdminTinkerEntryBySlug(slug)

  if (!entry) {
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
            Edit 燈工房 entry
          </h1>
        </div>
        <TinkerEditor entry={entry} />
      </main>
      <Footer />
    </>
  )
}