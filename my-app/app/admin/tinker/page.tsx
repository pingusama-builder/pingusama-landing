import Link from "next/link"
import { requireAdmin } from "@/lib/auth"
import { getAdminTinkerEntries } from "./actions"
import AdminHeader from "@/components/AdminHeader"
import AdminTinkerTable from "@/components/AdminTinkerTable"
import Footer from "@/components/Footer"

export default async function AdminTinkerPage() {
  await requireAdmin()

  // Graceful degradation: if the tinker_entries table is not yet applied
  // (schema cache miss before the migration runs), render the empty state
  // with a hint instead of crashing the whole admin page. Real errors still
  // surface in the editor's save path (saveTinkerEntryAction try/catch).
  let entries: Awaited<ReturnType<typeof getAdminTinkerEntries>> = []
  let tableMissing = false
  try {
    entries = await getAdminTinkerEntries({ limit: 100 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("tinker_entries")) {
      tableMissing = true
    } else {
      throw err
    }
  }

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
              燈工房
            </h1>
            <p className="text-sm text-[var(--walnut-soft)] mt-1">
              靈氣 prompts · 吉光片羽
            </p>
          </div>
          <Link href="/admin/tinker/new" className="pill live">
            New entry
          </Link>
        </div>

        {tableMissing ? (
          <div className="detail">
            <p className="detail-desc">
              <code>tinker_entries</code> table 未喺 Supabase 建立。
              Run{" "}
              <code>npx tsx scripts/apply-tinker-entries.ts</code>{" "}
              去 apply migration（會 seed Q7）。
            </p>
          </div>
        ) : entries.length === 0 ? (
          <div className="detail">
            <p className="detail-desc">
              No entries yet.{" "}
              <Link href="/admin/tinker/new" className="open-link">
                Capture the first 靈氣 prompt
              </Link>
              .
            </p>
          </div>
        ) : (
          <AdminTinkerTable entries={entries} />
        )}
      </main>
      <Footer />
    </>
  )
}