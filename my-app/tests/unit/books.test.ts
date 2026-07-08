import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  isValidIsbn13,
  normalizeIsbn13,
  fetchBookByIsbn,
  resolveShelf,
} from "@/lib/books"

describe("isValidIsbn13", () => {
  it("accepts a valid ISBN-13", () => {
    expect(isValidIsbn13("9780307473394")).toBe(true)
  })

  it("accepts a hyphenated valid ISBN-13", () => {
    expect(isValidIsbn13("978-0-307-47339-4")).toBe(true)
  })

  it("rejects wrong length", () => {
    expect(isValidIsbn13("978030747339")).toBe(false)
    expect(isValidIsbn13("97803074733944")).toBe(false)
  })

  it("rejects an invalid check digit", () => {
    expect(isValidIsbn13("9780307473395")).toBe(false)
  })

  it("rejects non-numeric characters", () => {
    expect(isValidIsbn13("978030747339X")).toBe(false)
  })
})

describe("normalizeIsbn13", () => {
  it("removes hyphens and whitespace", () => {
    expect(normalizeIsbn13(" 978-0-307-47339-4 ")).toBe("9780307473394")
  })
})

describe("fetchBookByIsbn", () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.GOOGLE_BOOKS_API_KEY
    process.env.GOOGLE_BOOKS_API_KEY = "test-key"
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    process.env.GOOGLE_BOOKS_API_KEY = originalKey
    vi.restoreAllMocks()
  })

  it("returns null for an invalid ISBN", async () => {
    const book = await fetchBookByIsbn("not-an-isbn")
    expect(book).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("returns null when the API key is missing", async () => {
    delete process.env.GOOGLE_BOOKS_API_KEY
    const book = await fetchBookByIsbn("9780307473394")
    expect(book).toBeNull()
  })

  it("parses a Google Books response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: "abc123",
            volumeInfo: {
              title: "What I Talk About When I Talk About Running",
              subtitle: null,
              authors: ["Haruki Murakami"],
              publisher: "Vintage",
              publishedDate: "2009-08-11",
              pageCount: 192,
              infoLink: "https://books.google.com/books?id=abc123",
              imageLinks: { thumbnail: "https://example.com/cover.jpg" },
              industryIdentifiers: [
                { type: "ISBN_13", identifier: "9780307473394" },
              ],
            },
          },
        ],
      }),
    } as Response)

    const book = await fetchBookByIsbn("9780307473394")
    expect(book).not.toBeNull()
    expect(book?.title).toBe("What I Talk About When I Talk About Running")
    expect(book?.authors).toEqual(["Haruki Murakami"])
    expect(book?.isbn13).toBe("9780307473394")
    expect(book?.thumbnail).toBe("https://example.com/cover.jpg")
  })

  it("returns null when Google Books returns no items", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    } as Response)

    const book = await fetchBookByIsbn("9780307473394")
    expect(book).toBeNull()
  })

  it("retries on 5xx and returns null after exhausting retries", async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
    } as Response)

    const promise = fetchBookByIsbn("9780307473394")
    await vi.advanceTimersByTimeAsync(2000)
    const book = await promise

    expect(book).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })
})

describe("resolveShelf", () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.GOOGLE_BOOKS_API_KEY
    process.env.GOOGLE_BOOKS_API_KEY = "test-key"
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    process.env.GOOGLE_BOOKS_API_KEY = originalKey
    vi.restoreAllMocks()
  })

  it("resolves books for each shelf entry", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: "running",
            volumeInfo: {
              title: "Running Book",
              authors: ["A Runner"],
              industryIdentifiers: [{ type: "ISBN_13", identifier: "9780307473394" }],
            },
          },
        ],
      }),
    } as Response)

    const shelf = {
      currentlyReading: [{ isbn13: "9780307473394", note: "n1" }],
      tbr: [{ isbn13: "9780307473394", note: "n2" }],
    }

    const resolved = await resolveShelf(shelf)
    expect(resolved.currentlyReading).toHaveLength(1)
    expect(resolved.currentlyReading[0].title).toBe("Running Book")
    expect(resolved.currentlyReading[0].note).toBe("n1")
    expect(resolved.tbr).toHaveLength(1)
    expect(resolved.tbr[0].note).toBe("n2")
    expect(resolved.errors).toHaveLength(0)
  })

  it("reports unresolved entries when the API returns nothing", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    } as Response)

    const shelf = {
      currentlyReading: [{ isbn13: "0000000000000", note: "missing" }],
      tbr: [],
    }

    const resolved = await resolveShelf(shelf)
    expect(resolved.currentlyReading).toHaveLength(0)
    expect(resolved.errors).toHaveLength(1)
    expect(resolved.errors[0].isbn13).toBe("0000000000000")
  })
})
