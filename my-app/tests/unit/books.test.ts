import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  isValidIsbn13,
  normalizeIsbn13,
  fetchBookByIsbn,
  resolveShelf,
  warmBook,
  type Book,
} from "@/lib/books"

import {
  getBooksByIsbns,
  upsertBook,
  mirrorCover,
  bookRowToBook,
  isStale,
} from "@/lib/db/books";
import { fetchCoverBytes } from "@/lib/covers";

vi.mock("@/lib/db/books", () => ({
  getBooksByIsbns: vi.fn(),
  upsertBook: vi.fn(),
  mirrorCover: vi.fn(),
  bookRowToBook: vi.fn(),
  isStale: vi.fn(),
}));

vi.mock("@/lib/covers", () => ({
  fetchCoverBytes: vi.fn(),
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_BOOKS_API_KEY = "test-key";
  });
  afterEach(() => vi.restoreAllMocks());

  it("resolves entries from Supabase books without calling Google Books", async () => {
    const row = {
      isbn13: "9780307473394",
      google_books_id: "g1",
      title: "Running Book",
      subtitle: null,
      authors: ["A Runner"],
      publisher: null,
      published_date: null,
      page_count: null,
      info_link: null,
      isbn10: null,
      cover_url: "https://supabase.example/covers/9780307473394.jpg",
      cover_source: "google",
      has_cover: true,
      last_fetched_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    };
    vi.mocked(getBooksByIsbns).mockResolvedValue(new Map([["9780307473394", row]]));
    vi.mocked(bookRowToBook).mockImplementation((r) => ({
      googleBooksId: r.google_books_id ?? r.isbn13,
      title: r.title,
      subtitle: r.subtitle,
      authors: r.authors,
      publisher: r.publisher,
      publishedDate: r.published_date,
      pageCount: r.page_count,
      infoLink: r.info_link,
      thumbnail: null,
      isbn13: r.isbn13,
      isbn10: r.isbn10,
      coverUrl: r.cover_url,
      coverSource: r.cover_source,
    }));

    const shelf = {
      currentlyReading: [{ isbn13: "9780307473394", note: "n1" }],
      tbr: [{ isbn13: "9780307473394", note: "n2" }],
    };
    const resolved = await resolveShelf(shelf);

    expect(getBooksByIsbns).toHaveBeenCalledWith(["9780307473394", "9780307473394"]);
    expect(resolved.currentlyReading[0].title).toBe("Running Book");
    expect(resolved.currentlyReading[0].coverUrl).toBe("https://supabase.example/covers/9780307473394.jpg");
    expect(resolved.tbr[0].note).toBe("n2");
    expect(resolved.errors).toHaveLength(0);
  });

  it("reports unwarmed ISBNs as errors and renders degraded chips", async () => {
    vi.mocked(getBooksByIsbns).mockResolvedValue(new Map());
    globalThis.fetch = vi.fn();

    const shelf = {
      currentlyReading: [{ isbn13: "9780307473394", note: "note" }],
      tbr: [],
    };
    const resolved = await resolveShelf(shelf);

    expect(resolved.currentlyReading[0].title).toBe("9780307473394");
    expect(resolved.currentlyReading[0].coverUrl).toBeNull();
    expect(resolved.errors).toHaveLength(1);
    expect(resolved.errors[0].reason).toContain("Not warmed yet");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("warmBook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_BOOKS_API_KEY = "test-key";
    globalThis.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  const fullBook: Book = {
    googleBooksId: "g1",
    title: "Running",
    subtitle: null,
    authors: ["Haruki Murakami"],
    publisher: null,
    publishedDate: null,
    pageCount: null,
    infoLink: null,
    thumbnail: "http://books.google.com/books/content?id=g1&zoom=1",
    isbn13: "9780307473394",
    isbn10: null,
    coverUrl: null,
    coverSource: null,
  };

  // Real fetchBookByIsbn drives globalThis.fetch; this stubs the Google Books JSON.
  function googleBooksResponse(book: Book) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: book.googleBooksId,
            volumeInfo: {
              title: book.title,
              subtitle: book.subtitle,
              authors: book.authors,
              publisher: book.publisher,
              publishedDate: book.publishedDate,
              pageCount: book.pageCount,
              infoLink: book.infoLink,
              imageLinks: { thumbnail: book.thumbnail },
              industryIdentifiers: [
                { type: "ISBN_13", identifier: book.isbn13 ?? "" },
              ],
            },
          },
        ],
      }),
    } as Response;
  }

  it("reports error for an invalid ISBN without fetching", async () => {
    const result = await warmBook("not-an-isbn");
    expect(result.status).toBe("error");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("skips a fresh, covered row when force is false", async () => {
    vi.mocked(getBooksByIsbns).mockResolvedValue(
      new Map([
        [
          "9780307473394",
          {
            isbn13: "9780307473394",
            google_books_id: "g1",
            title: "Running",
            subtitle: null,
            authors: [],
            publisher: null,
            published_date: null,
            page_count: null,
            info_link: null,
            isbn10: null,
            cover_url: "u",
            cover_source: "google",
            has_cover: true,
            last_fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      ])
    );
    vi.mocked(isStale).mockReturnValue(false);

    const result = await warmBook("9780307473394");
    expect(result.status).toBe("skipped");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("warms a book: fetches metadata, mirrors cover, upserts row", async () => {
    vi.mocked(getBooksByIsbns).mockResolvedValue(new Map());
    vi.mocked(fetch).mockResolvedValue(googleBooksResponse(fullBook));
    vi.mocked(fetchCoverBytes).mockResolvedValue({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "image/jpeg",
      source: "google",
    });
    vi.mocked(mirrorCover).mockResolvedValue("https://supabase.example/covers/9780307473394.jpg");
    vi.mocked(upsertBook).mockResolvedValue(undefined);

    const result = await warmBook("9780307473394");
    expect(result.status).toBe("warmed");
    expect(mirrorCover).toHaveBeenCalledWith("9780307473394", expect.any(Buffer), "image/jpeg");
    expect(upsertBook).toHaveBeenCalled();
    const row = vi.mocked(upsertBook).mock.calls[0][0];
    expect(row.cover_url).toBe("https://supabase.example/covers/9780307473394.jpg");
    expect(row.has_cover).toBe(true);
  });

  it("returns no-cover when neither source yields a cover", async () => {
    vi.mocked(getBooksByIsbns).mockResolvedValue(new Map());
    vi.mocked(fetch).mockResolvedValue(googleBooksResponse(fullBook));
    vi.mocked(fetchCoverBytes).mockResolvedValue(null);
    vi.mocked(upsertBook).mockResolvedValue(undefined);

    const result = await warmBook("9780307473394");
    expect(result.status).toBe("no-cover");
    const row = vi.mocked(upsertBook).mock.calls[0][0];
    expect(row.has_cover).toBe(false);
    expect(row.cover_url).toBeNull();
  });

  it("returns error when Google Books metadata fetch fails", async () => {
    vi.mocked(getBooksByIsbns).mockResolvedValue(new Map());
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);

    const result = await warmBook("9780307473394");
    expect(result.status).toBe("error");
    expect(mirrorCover).not.toHaveBeenCalled();
  });
});
