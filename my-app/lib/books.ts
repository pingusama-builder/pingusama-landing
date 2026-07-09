import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidIsbn13, normalizeIsbn13 } from "./isbn";
import {
  getBooksByIsbns,
  upsertBook,
  mirrorCover,
  bookRowToBook,
  isStale,
  type BookRow,
} from "./db/books";
import { fetchCoverBytes } from "./covers";

export { isValidIsbn13, normalizeIsbn13 } from "./isbn";

export interface Book {
  googleBooksId: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedDate: string | null;
  pageCount: number | null;
  infoLink: string | null;
  thumbnail: string | null;
  isbn13: string | null;
  isbn10: string | null;
  coverUrl: string | null;
  coverSource: "google" | "openlibrary" | null;
}

export interface ShelfEntry {
  isbn13: string;
  note: string;
}

export interface ShelfData {
  currentlyReading: ShelfEntry[];
  tbr: ShelfEntry[];
}

export interface VaultData {
  clips: {
    title: string;
    url: string;
    source: string;
    date: string;
    note: string;
  }[];
}

export interface ShelfError {
  isbn13: string;
  note: string;
  reason: string;
}

export interface ResolvedShelf {
  currentlyReading: (Book & { note: string })[];
  tbr: (Book & { note: string })[];
  errors: ShelfError[];
}

export type WarmStatus = "warmed" | "skipped" | "no-cover" | "error";
export interface WarmResult {
  isbn13: string;
  status: WarmStatus;
  error?: string;
}

const API = "https://www.googleapis.com/books/v1/volumes";
const ONE_DAY = 60 * 60 * 24;

function getApiKey(): string | undefined {
  return process.env.GOOGLE_BOOKS_API_KEY;
}

async function fetchByIsbn(
  isbn13: string,
  apiKey: string,
  retries = 2
): Promise<Book | null> {
  const q = `isbn:${isbn13.replace(/-/g, "")}`;
  const url = new URL(API);
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", "3");
  url.searchParams.set("key", apiKey);

  let attempt = 0;
  while (true) {
    const res = await fetch(url.toString(), { next: { revalidate: ONE_DAY } });
    if (res.ok) {
      return parseBook(res);
    }

    const isRetryable = res.status >= 500 || res.status === 429;
    if (isRetryable && attempt < retries) {
      attempt++;
      const delay = 500 * attempt;
      console.warn(
        `Google Books fetch failed for ${isbn13}: HTTP ${res.status}; retrying in ${delay}ms (attempt ${attempt}/${retries})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    console.error(`Google Books fetch failed for ${isbn13}: HTTP ${res.status}`);
    return null;
  }
}

export async function fetchBookByIsbn(isbn13: string): Promise<Book | null> {
  const cleaned = normalizeIsbn13(isbn13);
  if (!isValidIsbn13(cleaned)) return null;
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const book = await fetchByIsbn(cleaned, apiKey);
  if (!book) return null;
  return { ...book, coverUrl: null, coverSource: null };
}

async function parseBook(res: Response): Promise<Book | null> {
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      volumeInfo?: {
        title?: string;
        subtitle?: string;
        authors?: string[];
        publisher?: string;
        publishedDate?: string;
        pageCount?: number;
        infoLink?: string;
        imageLinks?: { thumbnail?: string; smallThumbnail?: string };
        industryIdentifiers?: Array<{ type: string; identifier: string }>;
      };
    }>;
  };

  const item = data.items?.[0];
  if (!item) return null;

  const v = item.volumeInfo || {};
  return {
    googleBooksId: item.id,
    title: v.title ?? "Untitled",
    subtitle: v.subtitle ?? null,
    authors: v.authors ?? [],
    publisher: v.publisher ?? null,
    publishedDate: v.publishedDate ?? null,
    pageCount: v.pageCount ?? null,
    infoLink: v.infoLink ?? null,
    thumbnail:
      v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail ?? null,
    isbn13:
      v.industryIdentifiers?.find((x) => x.type === "ISBN_13")?.identifier ??
      null,
    isbn10:
      v.industryIdentifiers?.find((x) => x.type === "ISBN_10")?.identifier ??
      null,
    coverUrl: null,
    coverSource: null,
  };
}

export function warmBookToRow(
  book: Book,
  cover: {
    coverUrl: string | null;
    coverSource: "google" | "openlibrary" | null;
    hasCover: boolean;
  }
): BookRow {
  return {
    isbn13: book.isbn13 ?? "",
    google_books_id: book.googleBooksId,
    title: book.title,
    subtitle: book.subtitle,
    authors: book.authors,
    publisher: book.publisher,
    published_date: book.publishedDate,
    page_count: book.pageCount,
    info_link: book.infoLink,
    isbn10: book.isbn10,
    cover_url: cover.coverUrl,
    cover_source: cover.coverSource,
    has_cover: cover.hasCover,
    last_fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function warmBook(
  isbn13: string,
  opts: { force?: boolean } = {}
): Promise<WarmResult> {
  const cleaned = normalizeIsbn13(isbn13);
  if (!isValidIsbn13(cleaned)) {
    return { isbn13, status: "error", error: "Invalid ISBN-13" };
  }

  if (!opts.force) {
    const existing = (await getBooksByIsbns([cleaned])).get(cleaned);
    if (existing && existing.has_cover && !isStale(existing.last_fetched_at)) {
      return { isbn13: cleaned, status: "skipped" };
    }
  }

  const book = await fetchBookByIsbn(cleaned);
  if (!book) {
    return {
      isbn13: cleaned,
      status: "error",
      error: "Not found in Google Books",
    };
  }

  const cover = await fetchCoverBytes({
    googleBooksId: book.googleBooksId,
    isbn13: book.isbn13,
  });

  let coverUrl: string | null = null;
  let coverSource: "google" | "openlibrary" | null = null;
  let hasCover = false;
  if (cover) {
    try {
      coverUrl = await mirrorCover(cleaned, cover.bytes, cover.mimeType);
      coverSource = cover.source;
      hasCover = true;
    } catch (err) {
      console.warn(
        `Cover mirror failed for ${cleaned}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  await upsertBook(
    warmBookToRow(book, { coverUrl, coverSource, hasCover })
  );

  return {
    isbn13: cleaned,
    status: hasCover ? "warmed" : "no-cover",
  };
}

export async function resolveShelf(shelf: ShelfData): Promise<ResolvedShelf> {
  const allEntries = [...shelf.currentlyReading, ...shelf.tbr];
  const isbns = allEntries.map((e) => normalizeIsbn13(e.isbn13));
  const rows = await getBooksByIsbns(isbns);

  const toBook = (entry: ShelfEntry, isbn13: string): Book & { note: string } => {
    const row = rows.get(isbn13);
    if (row) {
      return { ...bookRowToBook(row), note: entry.note };
    }
    // Degraded fallback: no row in Supabase yet -> ISBN-labelled chip, no cover.
    return {
      googleBooksId: `isbn:${isbn13}`,
      title: isbn13,
      subtitle: null,
      authors: [],
      publisher: null,
      publishedDate: null,
      pageCount: null,
      infoLink: null,
      thumbnail: null,
      isbn13,
      isbn10: null,
      coverUrl: null,
      coverSource: null,
      note: entry.note,
    };
  };

  const errors: ShelfError[] = [];
  for (const entry of allEntries) {
    const isbn13 = normalizeIsbn13(entry.isbn13);
    if (!rows.has(isbn13)) {
      errors.push({
        isbn13,
        note: entry.note,
        reason: "Not warmed yet — open /admin/bench → Warm book covers",
      });
    }
  }

  return {
    currentlyReading: shelf.currentlyReading.map((e) =>
      toBook(e, normalizeIsbn13(e.isbn13))
    ),
    tbr: shelf.tbr.map((e) => toBook(e, normalizeIsbn13(e.isbn13))),
    errors,
  };
}

export function loadShelf(): ShelfData {
  const raw = readFileSync(
    join(process.cwd(), "lib", "data", "shelf.json"),
    "utf8"
  );
  return JSON.parse(raw) as ShelfData;
}
