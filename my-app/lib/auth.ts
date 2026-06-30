import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export type User = {
  id: string
  email?: string
  app_metadata?: { role?: string }
}

export function isAdmin(user: User | null): boolean {
  return user?.app_metadata?.role === "admin"
}

export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    return null
  }

  return {
    id: data.user.id,
    email: data.user.email,
    app_metadata: data.user.app_metadata as { role?: string } | undefined,
  }
}

export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser()

  if (!user || !isAdmin(user)) {
    redirect("/admin/login")
  }

  return user
}
