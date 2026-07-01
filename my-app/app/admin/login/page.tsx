"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError("")
    setLoading(true)

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (signInError) {
      setError(signInError.message)
      return
    }

    router.push("/admin/blog")
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-6 text-left">
          <label htmlFor="email" className="sr-only">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            className="w-full px-4 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] placeholder:text-[var(--walnut-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
          />
          <label htmlFor="password" className="sr-only">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
            className="w-full px-4 py-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] placeholder:text-[var(--walnut-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
          />
          {error && (
            <p className="text-sm text-center" style={{ color: "var(--terracotta-d)" }}>
              {error}
            </p>
          )}
          <button type="submit" className="pill cursor-pointer" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  )
}
