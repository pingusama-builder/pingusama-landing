export interface CoverResult {
  bytes: Buffer;
  mimeType: string;
  source: "google" | "openlibrary";
}

const MIN_VALID_BYTES = 1000; // Open Library serves an ~800-byte 1x1 placeholder
const FETCH_TIMEOUT_MS = 8000;

interface CoverSource {
  url: string;
  source: "google" | "openlibrary";
}

function googleCoverUrl(googleBooksId: string): string {
  const url = new URL("https://books.google.com/books/content");
  url.searchParams.set("id", googleBooksId);
  url.searchParams.set("printsec", "frontcover");
  url.searchParams.set("img", "1");
  url.searchParams.set("zoom", "0");
  url.searchParams.set("source", "gbs_api");
  return url.toString();
}

function openLibraryCoverUrl(isbn13: string): string {
  return `https://covers.openlibrary.org/b/isbn/${isbn13}/L.jpg`;
}

function sourcesFor(book: {
  googleBooksId: string;
  isbn13: string | null;
}): CoverSource[] {
  const sources: CoverSource[] = [];
  if (book.googleBooksId) {
    sources.push({ url: googleCoverUrl(book.googleBooksId), source: "google" });
  }
  if (book.isbn13) {
    sources.push({
      url: openLibraryCoverUrl(book.isbn13),
      source: "openlibrary",
    });
  }
  return sources;
}

async function fetchImage(url: string): Promise<CoverResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") ?? "";
    if (!mimeType.startsWith("image/")) return null;
    const ab = await res.arrayBuffer();
    const bytes = Buffer.from(ab);
    if (bytes.length < MIN_VALID_BYTES) return null;
    return { bytes, mimeType, source: "" as "google" | "openlibrary" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCoverBytes(book: {
  googleBooksId: string;
  isbn13: string | null;
}): Promise<CoverResult | null> {
  for (const source of sourcesFor(book)) {
    const got = await fetchImage(source.url);
    if (got) {
      return { ...got, source: source.source };
    }
  }
  return null;
}