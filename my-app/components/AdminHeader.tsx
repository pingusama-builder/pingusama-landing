"use client"

import Link from "next/link"
import { logout } from "@/app/admin/blog/actions"

export default function AdminHeader() {
  return (
    <header className="top wrap">
      <Link href="/admin/blog" className="brand">
        Pingusama<span className="dot">.</span> Admin
      </Link>
      <nav>
        <Link href="/admin/blog">blog</Link>
        <Link href="/admin/bench">bench</Link>
        <Link href="/admin/chat">chat</Link>
        <Link href="/">site</Link>
        <button
          onClick={() => logout()}
          className="open-link"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          sign out
        </button>
      </nav>
    </header>
  )
}
