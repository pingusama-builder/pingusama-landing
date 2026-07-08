import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({
    id: "admin-1",
    email: "admin@example.com",
  }),
}))

vi.mock("@/lib/db/bench", () => ({
  loadShelf: vi.fn(),
  loadVault: vi.fn(),
  saveShelf: vi.fn(),
  saveVault: vi.fn(),
}))

vi.mock("@/lib/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/books")>()
  return {
    ...actual,
    resolveShelf: vi.fn(),
    fetchBookByIsbn: vi.fn(),
  }
})

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}))

import {
  loadBenchData,
  saveShelfAction,
  saveVaultAction,
  refreshCacheAction,
  previewBookAction,
} from "@/app/admin/bench/actions"
import * as bench from "@/lib/db/bench"
import * as books from "@/lib/books"
import { writeFileSync } from "node:fs"
import { revalidatePath } from "next/cache"

describe("bench admin actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loadBenchData returns shelf and vault from the data layer", async () => {
    const shelf = { currentlyReading: [], tbr: [] }
    const vault = { clips: [] }
    vi.mocked(bench.loadShelf).mockResolvedValue(shelf)
    vi.mocked(bench.loadVault).mockResolvedValue(vault)

    const result = await loadBenchData()

    expect(result.shelf).toBe(shelf)
    expect(result.vault).toBe(vault)
  })

  it("saveShelfAction persists shelf and revalidates", async () => {
    const shelf = {
      currentlyReading: [{ isbn13: "9780307473394", note: "Running book" }],
      tbr: [],
    }

    const result = await saveShelfAction(shelf)

    expect(result).toEqual({ success: true })
    expect(bench.saveShelf).toHaveBeenCalledWith(shelf)
    expect(revalidatePath).toHaveBeenCalledWith("/")
    expect(revalidatePath).toHaveBeenCalledWith("/admin/bench")
  })

  it("saveShelfAction returns an error when persistence fails", async () => {
    vi.mocked(bench.saveShelf).mockRejectedValue(new Error("DB unavailable"))

    const result = await saveShelfAction({ currentlyReading: [], tbr: [] })

    expect(result.success).toBe(false)
    expect(result.error).toBe("DB unavailable")
  })

  it("saveVaultAction persists vault and revalidates", async () => {
    const vault = {
      clips: [
        {
          title: "Clip",
          url: "https://example.com",
          source: "blog",
          date: "1d ago",
          note: "",
        },
      ],
    }

    const result = await saveVaultAction(vault)

    expect(result).toEqual({ success: true })
    expect(bench.saveVault).toHaveBeenCalledWith(vault)
    expect(revalidatePath).toHaveBeenCalledWith("/")
  })

  it("saveVaultAction returns an error when persistence fails", async () => {
    vi.mocked(bench.saveVault).mockRejectedValue(new Error("DB unavailable"))

    const result = await saveVaultAction({ clips: [] })

    expect(result.success).toBe(false)
    expect(result.error).toBe("DB unavailable")
  })

  it("refreshCacheAction resolves the shelf and writes the cache file", async () => {
    const shelf = { currentlyReading: [], tbr: [] }
    const resolved = {
      currentlyReading: [
        {
          googleBooksId: "g1",
          title: "Book 1",
          authors: ["Author"],
          note: "",
        },
      ],
      tbr: [],
      errors: [],
    }
    vi.mocked(bench.loadShelf).mockResolvedValue(shelf)
    vi.mocked(books.resolveShelf).mockResolvedValue(resolved)

    const result = await refreshCacheAction()

    expect(result.success).toBe(true)
    expect(result.count).toBe(1)
    expect(books.resolveShelf).toHaveBeenCalledWith(shelf)
    expect(writeFileSync).toHaveBeenCalled()
    const written = JSON.parse(
      vi.mocked(writeFileSync).mock.calls[0][1] as string
    )
    expect(written.books).toHaveLength(1)
    expect(written.books[0].title).toBe("Book 1")
  })

  it("previewBookAction returns a book for a valid ISBN", async () => {
    const book = {
      googleBooksId: "g1",
      title: "Preview Book",
      subtitle: null,
      authors: ["Author"],
      publisher: null,
      publishedDate: null,
      pageCount: null,
      infoLink: null,
      thumbnail: null,
      isbn13: "9780307473394",
      isbn10: null,
    }
    vi.mocked(books.fetchBookByIsbn).mockResolvedValue(book)

    const result = await previewBookAction("9780307473394")

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.book.title).toBe("Preview Book")
    expect(books.fetchBookByIsbn).toHaveBeenCalledWith("9780307473394")
  })

  it("previewBookAction returns an error when no book is found", async () => {
    vi.mocked(books.fetchBookByIsbn).mockResolvedValue(null)

    const result = await previewBookAction("9780307473394")

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toContain("No book found")
  })
})
