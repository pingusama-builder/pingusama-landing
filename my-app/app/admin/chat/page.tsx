import { requireAdmin } from "@/lib/auth"
import AdminHeader from "@/components/AdminHeader"
import Footer from "@/components/Footer"
import ChatUI from "@/components/ChatUI"
import { listThreadsAction } from "./actions"

export default async function AdminChatPage() {
  await requireAdmin()
  const threads = await listThreadsAction()

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
              The companion
            </h1>
            <p className="detail-desc mt-2">
              A site-aware assistant that remembers. It can read the site (blog,
              shelf, wheel, vault, code) and save memories — but it can&apos;t
              edit anything. Admin-only pilot.
            </p>
          </div>
          <a className="chat-mem-pill" href="/admin/chat/memories">
            Manage memories →
          </a>
        </div>

        <ChatUI initialThreads={threads} />
      </main>
      <Footer />
    </>
  )
}