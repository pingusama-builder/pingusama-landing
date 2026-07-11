"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

// Floating "chat" button for admins only. On mount (and on window focus, to catch
// a just-completed login in another tab) it pings /api/me; if the visitor is an
// admin it renders a fixed bottom-right link to /admin/chat. Non-admins see
// nothing — it stays null until the check resolves, so there's no flash and no
// layout shift. Hidden on /admin/chat* where the admin header already links in.
export default function ChatFab() {
  const pathname = usePathname()
  const [admin, setAdmin] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" })
        const data = (await res.json()) as { admin?: boolean }
        if (!cancelled) {
          setAdmin(!!data.admin)
          setChecked(true)
        }
      } catch {
        if (!cancelled) setChecked(true)
      }
    }
    void check()
    window.addEventListener("focus", check)
    return () => {
      cancelled = true
      window.removeEventListener("focus", check)
    }
  }, [])

  if (!checked || !admin || pathname?.startsWith("/admin/chat")) return null

  return (
    <Link
      href="/admin/chat"
      className="chat-fab"
      aria-label="Open the companion chat"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
          fill="currentColor"
        />
      </svg>
      chat
    </Link>
  )
}