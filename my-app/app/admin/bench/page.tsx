import { requireAdmin } from "@/lib/auth"
import AdminHeader from "@/components/AdminHeader"
import Footer from "@/components/Footer"
import BenchEditor from "@/components/BenchEditor"
import {
  loadBenchData,
  saveShelfAction,
  saveVaultAction,
  warmBooksAction,
  listBookStatusesAction,
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
            搵書、選擇版本，再儲存書架。搜尋支援繁中、簡中及英文；搵唔到亦可手動加入。
            Shelf 同 Vault 分開儲存。
          </p>
        </div>

        <BenchEditor
          initialShelf={shelf}
          initialVault={vault}
          initialBookStatuses={await listBookStatusesAction([
            ...shelf.currentlyReading.map((e) => e.isbn13),
            ...shelf.tbr.map((e) => e.isbn13),
          ])}
          saveShelf={saveShelfAction}
          saveVault={saveVaultAction}
          warmBooks={warmBooksAction}
        />
      </main>
      <Footer />
    </>
  )
}
