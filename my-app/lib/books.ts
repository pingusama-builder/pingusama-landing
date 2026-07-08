import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidIsbn13, normalizeIsbn13 } from "./isbn";

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

const API = "https://www.googleapis.com/books/v1/volumes";
const ONE_DAY = 60 * 60 * 24;

let cache: Record<string, Book> | null = null;

function loadCache(): Record<string, Book> {
  if (cache) return cache;
  try {
    const raw = readFileSync(
      join(process.cwd(), "lib", "data", "shelf-cache.json"),
      "utf8"
    );
    const data = JSON.parse(raw) as { books: Book[] };
    cache = Object.fromEntries(
      data.books.map((b) => [b.isbn13 ?? b.googleBooksId, b])
    );
  } catch {
    cache = {};
  }
  return cache;
}

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
  return fetchByIsbn(cleaned, apiKey);
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
  };
}

export async function resolveShelf(shelf: ShelfData): Promise<ResolvedShelf> {
  const apiKey = getApiKey();
  const cache = loadCache();

  const resolve = async (entries: ShelfEntry[]) => {
    const results: (Book & { note: string })[] = [];
    const errors: ShelfError[] = [];
    for (const entry of entries) {
      let book: Book | null = null;
      if (apiKey) {
        book = await fetchByIsbn(entry.isbn13, apiKey);
      }
      if (!book) {
        book = cache[entry.isbn13] ?? null;
        if (book) {
          console.warn(`Using cached fallback for ${entry.isbn13}`);
        }
      }
      if (book) {
        results.push({ ...book, note: entry.note });
      } else {
        errors.push({
          isbn13: entry.isbn13,
          note: entry.note,
          reason: "Not found in Google Books or the local cache",
        });
      }
      // Small stagger to avoid hammering the Google Books API from the build machine.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return { results, errors };
  };

  const reading = await resolve(shelf.currentlyReading);
  const tbr = await resolve(shelf.tbr);

  return {
    currentlyReading: reading.results,
    tbr: tbr.results,
    errors: [...reading.errors, ...tbr.errors],
  };
}

export function loadShelf(): ShelfData {
  const raw = readFileSync(
    join(process.cwd(), "lib", "data", "shelf.json"),
    "utf8"
  );
  return JSON.parse(raw) as ShelfData;
}
