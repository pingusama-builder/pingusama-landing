import { createServiceClient } from "@/lib/supabase/server";
import type { Book } from "@/lib/books";

export interface BookRow {
  isbn13: string;
  google_books_id: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  published_date: string | null;
  page_count: number | null;
  info_link: string | null;
  isbn10: string | null;
  cover_url: string | null;
  cover_source: "google" | "openlibrary" | null;
  has_cover: boolean;
  last_fetched_at: string | null;
  updated_at: string;
}

export const STALE_AFTER_DAYS = 30;
const STALE_MS = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

export function isStale(lastFetchedAt: string | null): boolean {
  if (!lastFetchedAt) return true;
  const ts = Date.parse(lastFetchedAt);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > STALE_MS;
}

export async function getBooksByIsbns(
  isbns: string[]
): Promise<Map<string, BookRow>> {
  const map = new Map<string, BookRow>();
  if (isbns.length === 0) return map;
  const client = createServiceClient();
  const { data, error } = await client
    .from("books")
    .select("*")
    .in("isbn13", isbns);
  if (error || !data) {
    console.warn("getBooksByIsbns query failed:", error?.message ?? "no data");
    return map;
  }
  for (const row of data as BookRow[]) {
    map.set(row.isbn13, row);
  }
  return map;
}

export async function upsertBook(row: BookRow): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("books")
    .upsert(row, { onConflict: "isbn13" });
  if (error) {
    throw new Error(`Failed to upsert book ${row.isbn13}: ${error.message}`);
  }
}

function extForMimeType(mimeType: string): string {
  return mimeType.includes("png") ? "png" : "jpg";
}

export async function mirrorCover(
  isbn13: string,
  bytes: Buffer,
  mimeType: string
): Promise<string> {
  const ext = extForMimeType(mimeType);
  const path = `covers/${isbn13}.${ext}`;
  const client = createServiceClient();
  const { error } = await client.storage
    .from("covers")
    .upload(path, bytes, { contentType: mimeType, upsert: true });
  if (error) {
    throw new Error(`Failed to mirror cover for ${isbn13}: ${error.message}`);
  }
  return client.storage.from("covers").getPublicUrl(path).data.publicUrl;
}

export function bookRowToBook(
  row: BookRow
): Book & {
  coverUrl: string | null;
  coverSource: "google" | "openlibrary" | null;
} {
  return {
    googleBooksId: row.google_books_id ?? row.isbn13,
    title: row.title,
    subtitle: row.subtitle,
    authors: row.authors ?? [],
    publisher: row.publisher,
    publishedDate: row.published_date,
    pageCount: row.page_count,
    infoLink: row.info_link,
    thumbnail: null,
    isbn13: row.isbn13,
    isbn10: row.isbn10,
    coverUrl: row.cover_url,
    coverSource: row.cover_source,
  };
}
