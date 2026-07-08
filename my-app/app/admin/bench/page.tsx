import { requireAdmin } from "@/lib/auth"
import AdminHeader from "@/components/AdminHeader"
import Footer from "@/components/Footer"
import BenchEditor from "@/components/BenchEditor"
import {
  loadBenchData,
  saveShelfAction,
  saveVaultAction,
  refreshCacheAction,
  previewBookAction,
} from "./actions"

export default async function AdminBenchPage() {
  await requireAdmin()
  const { shelf, vault } = await loadBenchData()

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
            The bench
          </h1>
          <p className="detail-desc mt-2">
            Edit the shelf (ISBNs + notes) and the vault (clipped links). Save
            each tab separately. Refresh the book cache after changing ISBNs.
          </p>
        </div>

        <BenchEditor
          initialShelf={shelf}
          initialVault={vault}
          saveShelf={saveShelfAction}
          saveVault={saveVaultAction}
          refreshCache={refreshCacheAction}
          previewBook={previewBookAction}
        />
      </main>
      <Footer />
    </>
  )
}
