import { describe, it, expect } from "vitest"
import { isAdmin } from "@/lib/auth"

describe("isAdmin", () => {
  it("returns true when role is admin", () => {
    expect(isAdmin({ id: "1", app_metadata: { role: "admin" } })).toBe(true)
  })

  it("returns false when role is missing", () => {
    expect(isAdmin({ id: "1" })).toBe(false)
  })

  it("returns false when role is not admin", () => {
    expect(isAdmin({ id: "1", app_metadata: { role: "user" } })).toBe(false)
  })

  it("returns false for null user", () => {
    expect(isAdmin(null)).toBe(false)
  })
})
