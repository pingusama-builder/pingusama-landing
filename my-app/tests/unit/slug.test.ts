import { describe, it, expect } from "vitest"
import { sanitizeSlug, generateSlug } from "@/lib/slug"

describe("sanitizeSlug", () => {
  it("lowercases uppercase letters", () => {
    expect(sanitizeSlug("Hello World")).toBe("hello-world")
  })

  it("replaces spaces with dashes", () => {
    expect(sanitizeSlug("a b  c")).toBe("a-b-c")
  })

  it("strips special characters", () => {
    expect(sanitizeSlug("hello@world#2024!")).toBe("helloworld2024")
  })

  it("collapses multiple dashes", () => {
    expect(sanitizeSlug("hello---world")).toBe("hello-world")
  })

  it("removes leading and trailing dashes", () => {
    expect(sanitizeSlug("-hello-world-")).toBe("hello-world")
  })

  it("combines all transformations", () => {
    expect(sanitizeSlug("  Hello--WORLD!!  ")).toBe("hello-world")
  })
})

describe("generateSlug", () => {
  it("returns sanitized slug for unique title", () => {
    expect(generateSlug("My First Post")).toBe("my-first-post")
  })

  it("appends -2 on first collision", () => {
    expect(generateSlug("My Post", ["my-post"])).toBe("my-post-2")
  })

  it("progresses suffix on repeated collisions", () => {
    expect(generateSlug("My Post", ["my-post", "my-post-2", "my-post-3"])).toBe(
      "my-post-4",
    )
  })

  it("falls back to post when title sanitizes to empty", () => {
    expect(generateSlug("!!!")).toBe("post")
  })

  it("handles multiple collisions including fallback slug", () => {
    expect(generateSlug("!!!", ["post", "post-2"])).toBe("post-3")
  })
})
