import { requireAdmin } from "@/lib/auth"
import AdminHeader from "@/components/AdminHeader"
import TinkerEditor from "@/components/TinkerEditor"
import Footer from "@/components/Footer"
import { getAdminTinkerEntries } from "../actions"

export default async function NewTinkerEntryPage() {
  await requireAdmin()

  // List of existing entries drives the "Autofill from existing" picker.
  // Graceful degradation like the table page: a missing table just yields an
  // empty list, so the picker hides and the editor still works for new entries.
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
            New 燈工房 entry
          </h1>
        </div>
        <TinkerEditor entries={entries} />
      </main>
      <Footer />
    </>
  )
}