"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"

export default function AdminLoginPage() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError("")

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/admin/blog`,
      },
    })

    if (signInError) {
      setError(signInError.message)
      return
    }

    setSent(true)
  }

  return (
    <main className="wrap py-16">
      <div
        className="detail mx-auto"
        style={{ maxWidth: 420, textAlign: "center" }}
      >
        <p className="eyebrow">workshop admin</p>
        <h1 className="detail-title" style={{ fontSize: 28 }}>
          Sign in to manage posts
        </h1>

        {sent ? (
          <p className="detail-desc">
            Magic link sent. Check your inbox and click the link to continue.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-6">
            <label htmlFor="email" className="sr-only">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              className="w-full px-4 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] placeholder:text-[var(--walnut-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
            />
            {error && (
              <p className="text-sm" style={{ color: "var(--terracotta-d)" }}>
                {error}
              </p>
            )}
            <button type="submit" className="pill cursor-pointer">
              Send magic link
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
