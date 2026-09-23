import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidIsbn13, normalizeIsbn13, canonicalIsbn } from "./isbn";
import type { BookCandidate } from "./book-search";
import type { BookCoverAsset } from "./book-cover-types";
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
  coverAsset?: BookCoverAsset;
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
  requestedIsbn?: string;
  selection?: BookCandidate;
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
  retries = 2,
  reportErrors = false
): Promise<Book | null> {
  const q = `isbn:${isbn13.replace(/-/g, "")}`;
  const url = new URL(API);
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", "3");
  url.searchParams.set("key", apiKey);

  let attempt = 0;
  while (true) {
    const res = await fetch(url.toString(), { next: { revalidate: ONE_DAY }, signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      return parseBook(res, isbn13);
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
    if (reportErrors) throw new Error("Google Books 暫時無法查詢，請稍後重試。");
    return null;
  }
}

export async function fetchBookByIsbn(isbn13: string, reportErrors = false): Promise<Book | null> {
  const cleaned = normalizeIsbn13(isbn13);
  if (!isValidIsbn13(cleaned)) return null;
  const apiKey = getApiKey();
  if (!apiKey) {
    if (reportErrors) throw new Error("Google Books API key 未設定。");
    return null;
  }
  try {
    const book = await fetchByIsbn(cleaned, apiKey, reportErrors ? 0 : 2, reportErrors);
    if (!book) return null;
    return { ...book, coverUrl: null, coverSource: null };
  } catch {
    if (reportErrors) throw new Error("Google Books 暫時無法查詢，請稍後重試。");
    return null;
  }
}

// Open Library data API — the metadata + cover fallback when Google Books is
// unavailable (e.g. quota exhausted) or returns no match. Returns both the
// Book and the cover-by-ID URL (more reliable than the ISBN-keyed endpoint).
const OL_DATA_API = "https://openlibrary.org/api/books";

interface OpenLibraryResult {
  book: Book;
  olCoverUrl: string | null;
}

interface OLVolume {
  key?: string;
  url?: string;
  title?: string;
  subtitle?: string;
  authors?: Array<{ name: string }>;
  publishers?: Array<{ name: string }>;
  publish_date?: string;
  number_of_pages?: number;
  cover?: { small?: string; medium?: string; large?: string };
  identifiers?: {
    isbn_10?: string[];
    isbn_13?: string[];
  };
}

export async function fetchBookByOpenLibrary(
  isbn13: string,
  reportErrors = false
): Promise<OpenLibraryResult | null> {
  const cleaned = normalizeIsbn13(isbn13);
  if (!isValidIsbn13(cleaned)) return null;

  const url = new URL(OL_DATA_API);
  const bibkey = `ISBN:${cleaned}`;
  url.searchParams.set("bibkeys", bibkey);
  url.searchParams.set("format", "json");
  url.searchParams.set("jscmd", "data");

  try {
    const res = await fetch(url.toString(), { next: { revalidate: ONE_DAY }, signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error("Open Library 暫時無法查詢，請稍後重試。");
    const data = (await res.json()) as Record<string, OLVolume>;
    const vol = data[bibkey];
    if (!vol) return null;

    const identifiers = [...(vol.identifiers?.isbn_13 ?? []), ...(vol.identifiers?.isbn_10 ?? [])];
    if (!identifiers.some((id) => canonicalIsbn(id) === cleaned)) return null;
    const olid = vol.key?.replace("/books/", "") ?? cleaned;
    return {
      book: {
        googleBooksId: `ol:${olid}`,
        title: vol.title ?? "Untitled",
        subtitle: vol.subtitle ?? null,
        authors: vol.authors?.map((a) => a.name) ?? [],
        publisher: vol.publishers?.[0]?.name ?? null,
        publishedDate: vol.publish_date ?? null,
        pageCount: vol.number_of_pages ?? null,
        infoLink: vol.url ?? null,
        thumbnail: vol.cover?.small ?? vol.cover?.medium ?? null,
        isbn13: cleaned,
        isbn10: vol.identifiers?.isbn_10?.[0] ?? null,
        coverUrl: null,
        coverSource: null,
      },
      olCoverUrl: vol.cover?.large ?? vol.cover?.medium ?? null,
    };
  } catch (err) {
    if (reportErrors) throw new Error("Open Library 暫時無法查詢，請稍後重試。");
    console.warn(
      `Open Library fetch failed for ${cleaned}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function parseBook(res: Response, requestedIsbn: string): Promise<Book | null> {
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

  const item = data.items?.find((item) => item.volumeInfo?.industryIdentifiers?.some((id) => canonicalIsbn(id.identifier) === requestedIsbn));
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
    isbn13: requestedIsbn,
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

  let book = await fetchBookByIsbn(cleaned);
  let olCoverUrl: string | null = null;

  if (!book) {
    // Google Books unavailable (e.g. quota exhausted) or no match — fall back
    // to Open Library for metadata + a cover-by-ID URL.
    const ol = await fetchBookByOpenLibrary(cleaned);
    if (ol) {
      book = ol.book;
      olCoverUrl = ol.olCoverUrl;
    }
  }

  if (!book) {
    return {
      isbn13: cleaned,
      status: "error",
      error: "Not found in Google Books or Open Library",
    };
  }

  let cover = await fetchCoverBytes({
    googleBooksId: book.googleBooksId,
    isbn13: book.isbn13,
    olCoverUrl,
  });

  // Google returned metadata but no usable cover, and we haven't queried Open
  // Library yet. Its cover-by-ID endpoint is more reliable than the ISBN-keyed
  // one the loop above already tried, so do one OL data lookup to rescue it.
  if (!cover && !olCoverUrl) {
    const ol = await fetchBookByOpenLibrary(cleaned);
    if (ol?.olCoverUrl) {
      cover = await fetchCoverBytes({
        googleBooksId: "",
        isbn13: book.isbn13,
        olCoverUrl: ol.olCoverUrl,
      });
    }
  }

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
  const isbns = allEntries.filter(e => !e.selection).map((e) => normalizeIsbn13(e.isbn13));
  const rows = await getBooksByIsbns(isbns);

  const toBook = (entry: ShelfEntry, isbn13: string): Book & { note: string } => {
    if (entry.selection) return { ...entry.selection.book, note: entry.note };
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
    if (!entry.selection && !rows.has(isbn13)) {
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
