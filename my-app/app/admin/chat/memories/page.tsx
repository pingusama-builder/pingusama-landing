import { requireAdmin } from "@/lib/auth"
import AdminHeader from "@/components/AdminHeader"
import Footer from "@/components/Footer"
import MemoriesManager from "@/components/MemoriesManager"
import { listMemoriesAction } from "../actions"

export default async function AdminMemoriesPage() {
  await requireAdmin()
  const memories = await listMemoriesAction({})

  return (
    <>
      <AdminHeader />
      <main className="wrap py-8">
        <div className="mb-6 chat-head">
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
              Memories
            </h1>
            <p className="detail-desc mt-2">
              The companion&apos;s memory bank — durable facts it keeps across
              conversations, plus auto-maintained site awareness. Edit, deactivate,
              or refresh the site categories. The bot can only write here; it
              can&apos;t touch site content.
            </p>
          </div>
          <a className="chat-mem-pill" href="/admin/chat">
            ← Back to chat
          </a>
        </div>

        <MemoriesManager initialMemories={memories} />
      </main>
      <Footer />
    </>
  )
}