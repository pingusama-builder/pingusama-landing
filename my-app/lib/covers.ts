export interface CoverResult {
  bytes: Buffer;
  mimeType: string;
  source: "google" | "openlibrary";
}

const MIN_VALID_BYTES = 1000; // Open Library serves an ~800-byte 1x1 placeholder
const FETCH_TIMEOUT_MS = 8000;

// Google Books returns a generic "image not available" placeholder as a
// 575x750 8-bit grayscale PNG. Detect it by parsing the PNG IHDR chunk so we
// can fall back to Open Library instead of mirroring a useless grey box.
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function parsePngDimensions(bytes: Buffer): {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
} | null {
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return null;
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

function isGooglePlaceholder(bytes: Buffer): boolean {
  const dims = parsePngDimensions(bytes);
  return (
    !!dims &&
    dims.width === 575 &&
    dims.height === 750 &&
    dims.colorType === 0 &&
    dims.bitDepth === 8
  );
}

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
    if (!got) continue;
    if (source.source === "google" && isGooglePlaceholder(got.bytes)) continue;
    return { ...got, source: source.source };
  }
  return null;
}