import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
const inMock = vi.fn();
const upsertMock = vi.fn();
const uploadMock = vi.fn();
const fromMock = vi.fn();
const storageFromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: fromMock,
    storage: { from: storageFromMock },
  }),
}));

import {
  getBooksByIsbns,
  upsertBook,
  mirrorCover,
  bookRowToBook,
  isStale,
  type BookRow,
} from "@/lib/db/books";

function resetChain() {
  selectMock.mockReset();
  inMock.mockReset();
  upsertMock.mockReset();
  uploadMock.mockReset();
  fromMock.mockReset();
  storageFromMock.mockReset();

  // from(...).select(...).in(...)
  selectMock.mockReturnValue({ in: inMock });
  inMock.mockResolvedValue({ data: null, error: null });
  // from(...).upsert(...)
  upsertMock.mockResolvedValue({ error: null });
  fromMock.mockImplementation((table: string) => {
    if (table === "books") {
      return { select: selectMock, upsert: upsertMock };
    }
    return {};
  });
  // storage.from('covers').upload(...)
  uploadMock.mockResolvedValue({ data: { path: "covers/x.jpg" }, error: null });
  storageFromMock.mockImplementation(() => ({
    upload: uploadMock,
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://supabase.example/storage/v1/object/public/${path}` } }),
  }));
}

describe("getBooksByIsbns", () => {
  beforeEach(() => resetChain());

  it("returns a Map keyed by isbn13", async () => {
    const rows: BookRow[] = [
      {
        isbn13: "9780307473394",
        google_books_id: "g1",
        title: "Running",
        subtitle: null,
        authors: ["Haruki Murakami"],
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
      },
    ];
    inMock.mockResolvedValue({ data: rows, error: null });

    const map = await getBooksByIsbns(["9780307473394"]);
    expect(map.get("9780307473394")?.title).toBe("Running");
    expect(inMock).toHaveBeenCalledWith("isbn13", ["9780307473394"]);
  });

  it("returns an empty Map when the query errors", async () => {
    inMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const map = await getBooksByIsbns(["9780307473394"]);
    expect(map.size).toBe(0);
  });

  it("returns an empty Map for an empty input list", async () => {
    const map = await getBooksByIsbns([]);
    expect(map.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe("upsertBook", () => {
  beforeEach(() => resetChain());

  it("upserts with onConflict isbn13", async () => {
    const row: BookRow = {
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
      last_fetched_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    };
    await upsertBook(row);
    expect(upsertMock).toHaveBeenCalledWith(row, { onConflict: "isbn13" });
  });

  it("throws when upsert errors", async () => {
    upsertMock.mockResolvedValue({ error: { message: "nope" } });
    await expect(
      upsertBook({ ...({} as BookRow), isbn13: "x", title: "t", authors: [] })
    ).rejects.toThrow("nope");
  });
});

describe("mirrorCover", () => {
  beforeEach(() => resetChain());

  it("uploads to covers/{isbn}.jpg and returns the public URL", async () => {
    const url = await mirrorCover("9780307473394", Buffer.from([1, 2, 3]), "image/jpeg");
    expect(uploadMock).toHaveBeenCalledWith(
      "covers/9780307473394.jpg",
      Buffer.from([1, 2, 3]),
      { contentType: "image/jpeg", upsert: true }
    );
    expect(url).toBe("https://supabase.example/storage/v1/object/public/covers/9780307473394.jpg");
  });

  it("uses .png for png mime type", async () => {
    await mirrorCover("9780307473394", Buffer.from([1]), "image/png");
    expect(uploadMock).toHaveBeenCalledWith(
      "covers/9780307473394.png",
      expect.any(Buffer),
      { contentType: "image/png", upsert: true }
    );
  });

  it("throws when upload errors", async () => {
    uploadMock.mockResolvedValue({ data: null, error: { message: "upload failed" } });
    await expect(
      mirrorCover("9780307473394", Buffer.from([1]), "image/jpeg")
    ).rejects.toThrow("upload failed");
  });
});

describe("bookRowToBook", () => {
  it("maps snake_case row to camelCase Book", () => {
    const row: BookRow = {
      isbn13: "9780307473394",
      google_books_id: "g1",
      title: "Running",
      subtitle: "sub",
      authors: ["A"],
      publisher: "P",
      published_date: "2009",
      page_count: 100,
      info_link: "link",
      isbn10: "0307473392",
      cover_url: "https://supabase.example/covers/9780307473394.jpg",
      cover_source: "google",
      has_cover: true,
      last_fetched_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    };
    const book = bookRowToBook(row);
    expect(book).toEqual({
      googleBooksId: "g1",
      title: "Running",
      subtitle: "sub",
      authors: ["A"],
      publisher: "P",
      publishedDate: "2009",
      pageCount: 100,
      infoLink: "link",
      thumbnail: null,
      isbn13: "9780307473394",
      isbn10: "0307473392",
      coverUrl: "https://supabase.example/covers/9780307473394.jpg",
      coverSource: "google",
    });
  });
});

describe("isStale", () => {
  it("treats null as stale", () => {
    expect(isStale(null)).toBe(true);
  });
  it("treats a fresh date as not stale", () => {
    expect(isStale(new Date(Date.now() - 1_000_000).toISOString())).toBe(false);
  });
  it("treats a 40-day-old date as stale", () => {
    expect(isStale(new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString())).toBe(true);
  });
});
