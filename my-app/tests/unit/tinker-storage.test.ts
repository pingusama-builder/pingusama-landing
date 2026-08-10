import { describe, expect, test } from "vitest"
import { validateTinkerSource } from "@/lib/supabase/storage"

// Pure validation tests for the 燈工房 source upload — no Supabase env needed
// (validateTinkerSource is a pure function before the client upload call).

function file(name: string, type: string, sizeMb: number): File {
  // File.size is the only field validateTinkerSource reads beyond name/type.
  const blob = new Blob([new Uint8Array(Math.round(sizeMb * 1024 * 1024))], {
    type,
  })
  return new File([blob], name, { type })
}

describe("validateTinkerSource", () => {
  test("accepts markdown and text with explicit types", () => {
    expect(validateTinkerSource(file("notes.md", "text/markdown", 0.1)).ok).toBe(true)
    expect(validateTinkerSource(file("notes.txt", "text/plain", 0.1)).ok).toBe(true)
    expect(validateTinkerSource(file("data.json", "application/json", 0.1)).ok).toBe(true)
    expect(validateTinkerSource(file("rows.csv", "text/csv", 0.1)).ok).toBe(true)
  })

  test("accepts .md / .txt by suffix when the browser gives a generic type", () => {
    expect(validateTinkerSource(file("transcript.md", "application/octet-stream", 0.2)).ok).toBe(true)
    expect(validateTinkerSource(file("transcript.markdown", "application/octet-stream", 0.2)).ok).toBe(true)
  })

  test("rejects images and executables", () => {
    const img = validateTinkerSource(file("pic.png", "image/png", 0.1))
    expect(img.ok).toBe(false)
    if (!img.ok) expect(img.error).toContain("Unsupported file type")

    const exe = validateTinkerSource(file("evil.exe", "application/octet-stream", 0.1))
    expect(exe.ok).toBe(false)
  })

  test("rejects files over 5MB", () => {
    const big = validateTinkerSource(file("big.md", "text/markdown", 6))
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.error).toContain("too large")
  })
})