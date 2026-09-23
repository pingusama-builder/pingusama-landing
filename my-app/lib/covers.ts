import { traceBench } from "./bench-trace";
import sharp from "sharp";

export interface CoverImage {
  bytes: Buffer;
  mimeType: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
}
export interface CoverResult extends CoverImage { source: "google" | "openlibrary"; }

const MIN_VALID_BYTES = 1000; // Open Library serves an ~800-byte 1x1 placeholder
const FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

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

// Open Library's ISBN-keyed cover endpoint is unreliable — it often serves a
// 43-byte not-found placeholder even when a cover exists. The data API
// (`/api/books?jscmd=data`) returns a cover ID, and the ID-keyed endpoint
// (`/b/id/{id}-L.jpg`) is far more reliable. Callers pass that URL here when
// they have it (from fetchBookByOpenLibrary); it's tried ahead of the ISBN URL.
function sourcesFor(book: {
  googleBooksId: string;
  isbn13: string | null;
  olCoverUrl?: string | null;
}): CoverSource[] {
  const sources: CoverSource[] = [];
  // `ol:`-prefixed ids are synthesized for Open-Library-sourced books and are
  // not valid Google Books volume ids, so never build a Google cover URL from them.
  if (/^[\w-]+$/.test(book.googleBooksId)) {
    sources.push({ url: googleCoverUrl(book.googleBooksId), source: "google" });
  }
  if (book.olCoverUrl && /^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-[SML]\.jpg(?:\?.*)?$/.test(book.olCoverUrl)) {
    sources.push({ url: book.olCoverUrl, source: "openlibrary" });
  }
  if (book.isbn13) {
    sources.push({
      url: openLibraryCoverUrl(book.isbn13),
      source: "openlibrary",
    });
  }
  return sources;
}

export async function decodeCoverBytes(bytes: Buffer, mimeType: string): Promise<CoverImage | null> {
  if (bytes.length < MIN_VALID_BYTES || bytes.length > MAX_IMAGE_BYTES || (mimeType !== "" && !/^image\/(jpeg|png|webp)(?:;|$)/i.test(mimeType)) || isGooglePlaceholder(bytes)) return null;
  try {
    const decoder = sharp(bytes, {limitInputPixels:16_000_000,failOn:"warning"});
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height || metadata.width < 60 || metadata.height < 90 || (metadata.pages ?? 1) > 1) return null;
    const detectedMime = {jpeg:"image/jpeg",png:"image/png",webp:"image/webp"}[metadata.format as "jpeg"|"png"|"webp"];
    if (!detectedMime) return null;
    await decoder.stats();
    return {bytes,mimeType:detectedMime,width:metadata.width,height:metadata.height};
  } catch { return null; }
}

export async function fetchVerifiedCoverImage(url: string): Promise<CoverImage | null> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !["books.google.com","covers.openlibrary.org","cdnec.sanmin.com.tw","cdn.kingstone.com.tw","www.bitmapbooks.com","neodb.social","imusic.b-cdn.net"].includes(parsed.hostname)) return null;
  if (parsed.hostname === "www.bitmapbooks.com" && !/^\/cdn\/shop\/(files|products)\//.test(parsed.pathname)) return null;
  if (parsed.hostname === "neodb.social" && !/^\/m\/item\/book\//.test(parsed.pathname)) return null;
  if (parsed.hostname === "imusic.b-cdn.net" && !/^\/images\/item\/original\/\d+\/\d{13}\.jpg$/.test(parsed.pathname)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      next: { revalidate: 0 },
    });
    traceBench("cover.http",res.ok?"received":"failed",{provider:parsed.hostname,httpStatus:res.status});
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type") ?? "";
    if ((mimeType !== "" && !/^image\/(jpeg|png|webp)(?:;|$)/i.test(mimeType))) return null;
    if (Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    const image = await decodeCoverBytes(bytes,mimeType);
    traceBench("cover.decode",image?"accepted":"rejected",{provider:parsed.hostname,code:isGooglePlaceholder(bytes)?"placeholder":image?"valid":"invalid_image",bytes:bytes.length,width:image?.width,height:image?.height});
    return image ? {...image,sourceUrl:url} : null;
  } catch {
    traceBench("cover.http","failed",{provider:parsed.hostname,code:"network_timeout_or_redirect"});
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCoverBytes(book: {
  googleBooksId: string;
  isbn13: string | null;
  olCoverUrl?: string | null;
}): Promise<CoverResult | null> {
  for (const source of sourcesFor(book)) {
    const got = await fetchVerifiedCoverImage(source.url);
    if (!got) continue;
    if (source.source === "google" && isGooglePlaceholder(got.bytes)) continue;
    return { ...got, source: source.source };
  }
  return null;
}
