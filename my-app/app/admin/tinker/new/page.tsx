import { requireAdmin } from "@/lib/auth"
import AdminHeader from "@/components/AdminHeader"
import TinkerEditor from "@/components/TinkerEditor"
import Footer from "@/components/Footer"

export default async function NewTinkerEntryPage() {
  await requireAdmin()

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
        <TinkerEditor />
      </main>
      <Footer />
    </>
  )
}