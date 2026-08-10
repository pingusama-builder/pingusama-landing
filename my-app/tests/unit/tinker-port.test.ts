import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

// Static port guard for the 燈工房 (tinker) trove — no Supabase env needed.
// Pins the architecture: tinker.html fetches the API route (not the legacy
// static JSON), the public API route + admin pages exist, the storage upload
// fn accepts text and reuses the blog-assets bucket, and the admin nav links
// to the new room. Mirrors atlas-port.test.ts's read-only style.

const root = process.cwd()
const publicRoot = join(root, "public", "portrait")
const tinkerHtmlPath = join(publicRoot, "tinker.html")
const tinkerHtml = existsSync(tinkerHtmlPath)
  ? readFileSync(tinkerHtmlPath, "utf8")
  : ""

function read(rel: string): string {
  const p = join(root, rel)
  return existsSync(p) ? readFileSync(p, "utf8") : ""
}

describe("燈工房 tinker port", () => {
  test("tinker.html fetches the Supabase-backed API, not the legacy JSON", () => {
    expect(tinkerHtml).toContain('var ENTRIES_URL = "/api/tinker-entries"')
    // legacy static JSON must no longer be the fetch source
    expect(tinkerHtml).not.toContain('var ENTRIES_URL = "/portrait/tinker-entries.json"')
  })

  test("keeps the warm-lamp + cold-thinking design tokens", () => {
    expect(tinkerHtml).toContain("--jade:")
    expect(tinkerHtml).toContain("--jade-soft:")
    expect(tinkerHtml).toContain("flame-flicker")
    expect(tinkerHtml).toContain("prefers-reduced-motion: reduce")
  })

  test("public API route exists and returns the entries shape", () => {
    const route = read("app/api/tinker-entries/route.ts")
    expect(route).toContain("getPublishedTinkerEntries")
    expect(route).toContain('Response.json({ entries:')
  })

  test("DB layer mirrors posts (service client, published read)", () => {
    const db = read("lib/db/tinker.ts")
    expect(db).toContain("createServiceClient")
    expect(db).toContain("getPublishedTinkerEntries")
    expect(db).toContain("createTinkerEntry")
    expect(db).toContain("updateTinkerEntry")
    expect(db).toContain("deleteTinkerEntry")
  })

  test("storage upload reuses blog-assets bucket under tinker/ prefix and accepts text", () => {
    const storage = read("lib/supabase/storage.ts")
    expect(storage).toContain("uploadTinkerSource")
    expect(storage).toContain("tinker/")
    // accepts text types, not just images
    expect(storage).toContain("text/markdown")
    expect(storage).toContain("text/plain")
    // reuses the same bucket constant (no new bucket)
    expect(storage).toContain("from(BUCKET)")
  })

  test("admin pages + actions exist (mirror blog)", () => {
    expect(existsSync(join(root, "app/admin/tinker/page.tsx"))).toBe(true)
    expect(existsSync(join(root, "app/admin/tinker/new/page.tsx"))).toBe(true)
    expect(
      existsSync(join(root, "app/admin/tinker/edit/[slug]/page.tsx")),
    ).toBe(true)
    expect(existsSync(join(root, "app/admin/tinker/actions.ts"))).toBe(true)
    expect(existsSync(join(root, "components/TinkerEditor.tsx"))).toBe(true)
    expect(existsSync(join(root, "components/AdminTinkerTable.tsx"))).toBe(true)

    const actions = read("app/admin/tinker/actions.ts")
    expect(actions).toContain("saveTinkerEntryAction")
    expect(actions).toContain("deleteTinkerEntryAction")
    expect(actions).toContain('revalidatePath("/portrait/tinker")')
  })

  test("admin header links to the tinker room", () => {
    const header = read("components/AdminHeader.tsx")
    expect(header).toContain('href="/admin/tinker"')
  })

  test("schema.sql declares tinker_entries with public-read-published RLS", () => {
    const schema = read("lib/db/schema.sql")
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS public.tinker_entries")
    expect(schema).toContain("Public read published tinker entries")
    expect(schema).toContain("ENABLE ROW LEVEL SECURITY")
  })

  test("migration script is idempotent and seeds Q7", () => {
    const script = read("scripts/apply-tinker-entries.ts")
    expect(script).toContain("CREATE TABLE IF NOT EXISTS public.tinker_entries")
    expect(script).toContain("ON CONFLICT (slug) DO NOTHING")
    expect(script).toContain("q7-unity-redesign")
  })
})