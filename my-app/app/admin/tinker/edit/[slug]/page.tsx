import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/auth"
import {
  getAdminTinkerEntryBySlug,
  getAdminTinkerEntries,
} from "../../actions"
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

  // List of existing entries drives the "Autofill from existing" picker so the
  // admin can jump to another entry to edit without returning to the table.
  let entries: Awaited<ReturnType<typeof getAdminTinkerEntries>> = []
  try {
    entries = await getAdminTinkerEntries({ limit: 100 })
  } catch {
    entries = []
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
        <TinkerEditor key={entry.slug} entry={entry} entries={entries} />
      </main>
      <Footer />
    </>
  )
}