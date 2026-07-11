import { getCurrentUser, isAdmin } from "@/lib/auth"

// Lightweight "am I an admin?" check for the client-side chat FAB. Returns only
// a boolean — no user data leaves the server. Reading the auth cookie via
// getCurrentUser (next/headers cookies()) opts this route into dynamic rendering.
export const runtime = "nodejs"

export async function GET() {
  const user = await getCurrentUser()
  return Response.json({ admin: !!(user && isAdmin(user)) })
}