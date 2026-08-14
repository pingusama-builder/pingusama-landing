// Live Open Library fallback harness for the shelf.
//
// EXPLICIT, OPT-IN — SKIPPED unless RUN_LIVE_BOOKS=1 is set, so the default
// `npx vitest run` never hits the network. Run explicitly:
//
//   RUN_LIVE_BOOKS=1 npx vitest run tests/live/books-openlibrary.live.test.ts
//
// WHY THIS EXISTS. Google Books' API key project had its daily quota set to 0
// (HTTP 429 RESOURCE_EXHAUSTED, quota_limit_value "0"), which broke shelf
// warming for every book — no metadata, no cover. Open Library is now the
// fallback source. This harness drives the REAL shipped `fetchBookByOpenLibrary`
// (no mocks) against the two TBR ISBNs that were showing no information, and
// confirms the cover-by-ID URL the data API returns resolves to a real image
// (not the 43-byte not-found placeholder the ISBN-keyed endpoint serves).
//
// No Supabase / admin login required: this exercises only the Open Library
// read path (metadata + cover URL), which is the load-bearing new code.
// `warmBook` itself is unit-pinned (books.test.ts) with the db layer mocked.

import { describe, it, expect } from "vitest";
import { fetchBookByOpenLibrary } from "@/lib/books";

const RUN_LIVE = process.env.RUN_LIVE_BOOKS === "1";
const describeLive = RUN_LIVE ? describe : describe.skip;

// The two TBR ISBNs from lib/data/shelf.json that were rendering as bare chips.
const TBR = [
  {
    isbn13: "9780593652886",
    title: "The Creative Act: A Way of Being",
    author: "Rick Rubin",
  },
  {
    isbn13: "9780143111610",
    title: "The Once and Future King",
    author: "T. H. White",
  },
];

const MIN_REAL_COVER_BYTES = 1000; // mirrors lib/covers.ts MIN_VALID_BYTES

describeLive("fetchBookByOpenLibrary (live, real Open Library)", () => {
  for (const expected of TBR) {
    it(`resolves metadata + a real cover URL for ${expected.isbn13}`, async () => {
      const result = await fetchBookByOpenLibrary(expected.isbn13);
      expect(result).not.toBeNull();
      const book = result!.book;

      // Metadata.
      expect(book.isbn13).toBe(expected.isbn13); // keyed by queried ISBN
      expect(book.title).toContain(expected.title.split(":")[0]);
      expect(book.authors.join(", ")).toContain(expected.author);
      expect(book.googleBooksId.startsWith("ol:")).toBe(true);

      // The cover-by-ID URL must be present and resolve to a real image.
      const coverUrl = result!.olCoverUrl;
      expect(coverUrl).toBeTruthy();
      expect(coverUrl).toMatch(/covers\.openlibrary\.org\/b\/id\//);

      const res = await fetch(coverUrl!, { redirect: "follow" });
      expect(res.ok).toBe(true);
      expect((res.headers.get("content-type") ?? "").startsWith("image/")).toBe(true);
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.length).toBeGreaterThanOrEqual(MIN_REAL_COVER_BYTES);
    }, 30000);
  }
});