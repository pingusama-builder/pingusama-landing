# Book Cover Resolution — Design

**Date:** 2026-07-10
**Project:** Pingusama's Tinkering (`pingusama-site-mockup-wheel/my-app`)
**Status:** Approved

## Problem

The bench's book covers depend on the Google Books API at two moments, and both are fragile:

1. **Build/render time.** `resolveShelf` (`lib/books.ts`) calls Google Books for every shelf entry on every build/render, only falling back to the committed `lib/data/shelf-cache.json` when a fetch returns null. Vercel builds intermittently see HTTP 503 (`Google Books fetch failed for 978...` and `Google Books fetch failed for : HTTP 503` for an empty ISBN). The cache is a fallback, never the primary source.
2. **View time.** Cover thumbnails are `http://books.google.com/books/content?...&zoom=1` URLs — tiny, http (mixed-content risk on the https site), and served from Google's image CDN, which can flake independently of the metadata API.

Additional issues: empty/invalid ISBNs in shelf data still trigger failed lookups (`resolveShelf` calls `fetchByIsbn` directly without the ISBN-10/13 validation guard that `fetchBookByIsbn` applies); the local cache JSON is not shared across builds/regions; there is no retry beyond per-ISBN attempts; thumbnails sometimes come back small or missing.

## Goals

- Eliminate build-time Google Books calls entirely. The homepage build/render reads only from Supabase.
- Make covers durable at view time by mirroring image bytes into Supabase Storage, so the visitor's browser loads a Supabase https URL and never touches Google Books.
- Fix the cover quality problem (fetch larger covers, not `zoom=1`).
- Reject empty/invalid ISBNs before any fetch, with actionable reporting in the admin editor.
- Keep admin as the only warming path; surfaces per-ISBN warm status and lets the admin fix bad entries.
- Preserve the Fraunces/Nunito token system in `app/globals.css` and verify mobile at 390 px.

## Non-goals

- No background refresh queue or scheduled warming cron. Warming is admin-triggered.
- No request-time stale-while-revalidate against Google Books. A book not yet warmed degrades gracefully rather than reaching out to Google Books at render time.
- No changes to shelf/vault persistence (`lib/db/bench.ts`) beyond reading shelf entries as today.

## Decisions

| Decision | Choice |
|---|---|
| Cover durability | Mirror cover image bytes into a `covers` Supabase Storage bucket; store the public https URL in `public.books.cover_url`. |
| Warming model | Admin-only. The production build/render reads Supabase only and never calls Google Books. |
| Cover source priority | Google Books first (cover URL upgraded to https, `zoom=0`), Open Library (`-L.jpg`, ~500px) as fallback when Google Books has no thumbnail. |
| Staleness window | 30 days. A row is "stale" when `last_fetched_at < now() - 30d`; the admin can force a re-warm. |
| Image optimization | Keep `next/image unoptimized` (images are tiny; avoids new image-config surface). Add the Supabase Storage host to `next.config` `images.remotePatterns` for future flexibility. |
| Writes / RLS | Service-role only, matching the existing `bench` table. The `covers` bucket is public-read so the browser can load images directly. |
| Unwarmed book at render | Render an ISBN-labelled chip + placeholder cover and push an actionable error; do **not** fetch Google Books at render time. |
| Legacy `shelf-cache.json` | Removed from the homepage read path. Kept on disk only as a legacy artifact; no longer read or written by `resolveShelf`. |

## Architecture

```
admin /admin/bench                      production build/render
────────────────────                    ────────────────────────
warmBooksAction / previewBookAction     resolveShelf(shelf)
  │                                       │
  ├─ validate + normalize ISBN            └─ getBooksByIsbns(isbns)  → Supabase public.books
  ├─ fetchByIsbn (Google Books metadata)                                   │
  ├─ fetchCoverBytes (Google zoom=0       ┌───────────────────────────┘
  │      → Open Library -L.jpg fallback)  map rows → Book[] (cover_url = Supabase URL)
  ├─ mirrorCover → Storage covers/{isbn}.jpg   errors[] for unwarmed ISBNs
  └─ upsertBook → public.books            BenchOverlay renders cover_url via <img>/<Image>
```

Google Books and Open Library are only ever contacted from the admin warming path, never from the build or the visitor's browser.

## Data model

Idempotent additions to `lib/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS public.books (
  isbn13           text PRIMARY KEY,
  google_books_id  text,
  title            text NOT NULL,
  subtitle         text,
  authors          text[],
  publisher        text,
  published_date   text,
  page_count       int,
  info_link        text,
  isbn10           text,
  cover_url        text,          -- Supabase Storage public URL (https)
  cover_source     text,          -- 'google' | 'openlibrary' | null
  has_cover        boolean NOT NULL DEFAULT false,
  last_fetched_at  timestamptz,
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies: the homepage warms/reads via the service role
-- (lib/supabase/server.ts createServiceClient), which bypasses RLS — same pattern as public.bench.
```

A `covers` Storage bucket with policies mirroring the existing `blog-assets` block:

- Bucket `covers`, `public = true`.
- Public-read policy (`SELECT` for anon/authenticated where `bucket_id = 'covers'`) so the browser loads covers directly.
- Authenticated insert/update/delete policies for the admin warming path.

Public cover URL shape: `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/covers/{isbn13}.jpg`.

## Module boundaries

### `lib/db/books.ts` (new)
Supabase data layer for book rows and the `covers` bucket.

- `getBooksByIsbns(isbns: string[]): Promise<Map<string, BookRow>>` — single `in` query.
- `upsertBook(row: BookRow): Promise<void>` — insert/update with `last_fetched_at = now()`.
- `mirrorCover(isbn13: string, bytes: Buffer, mimeType: string): Promise<string>` — upload to `covers/{isbn13}.{ext}`, upsert on conflict, return the public URL.
- Uses `createServiceClient()` from `lib/supabase/server`.

### `lib/covers.ts` (new)
Cover source resolution, isolated and unit-testable.

- `fetchCoverBytes(book): Promise<{ bytes: Buffer; mimeType: string; source: "google" | "openlibrary" } | null>`.
  - Try the Google Books cover URL derived from the book's `googleBooksId`, upgraded to https with `zoom=0` (replacing the current `zoom=1`).
  - If that returns no image (404, non-image content-type, or empty), try Open Library `https://covers.openlibrary.org/b/isbn/{isbn13}-L.jpg`.
  - Reject the Open Library "not found" 1×1 transparent placeholder by checking `content-length > 1000` bytes (the placeholder is ~800 bytes) and `content-type` starts with `image/`.
  - Single attempt per source with a fetch timeout; failures fall through to the next source.

### `lib/books.ts`
- Keep `fetchByIsbn` and `parseBook` for warming.
- Rewrite `resolveShelf(shelf)` to call `getBooksByIsbns` and map rows onto shelf entries; produce `errors[]` for unwarmed ISBNs with reason `"Not warmed yet — open /admin/bench → Warm book covers"`.
- Extend the `Book` interface with `coverUrl: string | null` and `coverSource: "google" | "openlibrary" | null`. `thumbnail` remains as the raw external URL used by the admin pre-warm preview.
- Remove the `loadCache`/`shelf-cache.json` read from `resolveShelf`. Delete the `shelf-cache.json` read path; the file stays on disk but is no longer referenced.

### `app/admin/bench/actions.ts`
- Rename `refreshCacheAction` → `warmBooksAction({ force }: { force?: boolean })`:
  - Load shelf via `loadShelf()`.
  - Collect unique ISBNs across `currentlyReading` + `tbr`; normalize + validate each. Invalid/empty ISBNs are reported in the result, never fetched.
  - For each valid ISBN: if a row exists with `has_cover = true` and `last_fetched_at` within 30 days and `force` is false → skip. Otherwise fetch metadata → resolve cover → mirror → upsert. Collect per-ISBN outcomes `{ isbn13, status: "warmed" | "skipped" | "stale" | "no-cover" | "error" }`.
  - `revalidatePath("/")` and `revalidatePath("/admin/bench")` on success.
- `previewBookAction(isbn13)` now also warms (writes the `books` row + mirrors the cover) in addition to returning the book, so preview === warm.
- New `listBookStatusesAction(): Promise<{ isbn13; status; hasCover; lastFetchedAt; coverUrl }[]>` for the editor UI. Uses the 30-day staleness check.

### `components/BenchEditor.tsx`
- Replace **"Refresh book cache"** with **"Warm book covers"** (calls `warmBooksAction({ force: false })`) plus a **"Re-warm all"** variant (`force: true`).
- Per-ISBN status row: ✓ warmed / ⟳ stale (>30d) / ⊘ missing cover / ⚠ fetch error, with the Supabase cover thumbnail shown beside each row. Invalid ISBNs are flagged in-editor (the green/red border + hint already exists).
- Tokens stay within the Fraunces/Nunito system in `globals.css`.

### `components/BenchOverlay.tsx`
- `Cover` uses `book.coverUrl` (falls back to the existing placeholder when `coverUrl` is null/`has_cover` false).
- `BookNoteChip` label falls back to the ISBN when `book.title` is absent (unwarmed book).
- Keep `next/image unoptimized`.

### `next.config`
- Add the Supabase Storage host to `images.remotePatterns` (for future optimization; `unoptimized` stays for now).

### `scripts/warm-books.ts` (new)
CLI warmer mirroring `scripts/seed-bench.ts` — loads shelf from Supabase, warms every valid ISBN, prints per-ISBN outcomes. Used for the initial production seeding.

## Warming detail

1. `normalizeIsbn13(isbn)` + `isValidIsbn13(isbn)`. Reject empties/invalid → reported, not fetched. This fixes `Google Books fetch failed for : HTTP 503`.
2. Metadata from Google Books via the existing `fetchByIsbn` (2 retries, 500ms × attempt backoff). On metadata failure, record `status: "error"` and move on; do not crash the whole warm.
3. Cover from `lib/covers.ts`. If metadata resolves but neither source yields a cover, write the row with `has_cover = false`, `cover_url = null`, `status: "no-cover"`.
4. Mirror via `mirrorCover`; upsert `books` with `cover_url`, `cover_source`, `has_cover = true`, `last_fetched_at = now()`, `status: "warmed"`.
5. Idempotent: skip rows that are warm and fresh unless `force`.

## Read flow (homepage)

`resolveShelf(shelf)`:
- `getBooksByIsbns([...currentlyReading, ...tbr].map(e => e.isbn13))` → `Map<isbn13, BookRow>`.
- For each shelf entry: if a row exists → build a `Book` with `coverUrl` from the row; the overlay renders it. If no row → push to `errors` with the actionable reason; render that entry's chip with the ISBN as its label and the note intact.
- No network call to Google Books or Open Library.

## Testing

- **New `tests/unit/covers.test.ts`** — Google-first source priority; https + `zoom=0` URL upgrade; Open Library fallback when Google returns no image; Open Library 1×1 placeholder rejection via `content-length`; timeout/failed-source fallthrough.
- **Update `tests/unit/books.test.ts`** — `resolveShelf` reads from a mocked `getBooksByIsbns`: a warmed ISBN resolves with `coverUrl`; an unwarmed ISBN yields an error and an ISBN-labelled chip; empty/invalid ISBNs in shelf data are reported, not fetched. ISBN validation/normalization tests stay.
- **Update `tests/unit/bench-actions.test.ts`** — `warmBooksAction` warms valid ISBNs, skips fresh rows, force re-warms stale rows, skips/reports invalid ISBNs; `previewBookAction` warms and returns the book.
- Verification: `npm run build`, `npm test`, mobile inspection at 390 px (status badges wrap, cover row single-column, no token drift), then `vercel --prod`.

## Migration

1. Append `public.books` + the `covers` bucket/policies to `lib/db/schema.sql` (idempotent).
2. Apply the schema to the production Supabase project (`kuyytbmmvxcmiyxqsnpe` / `pingusama-tinkering`).
3. Warm the 5 existing shelf books via `scripts/warm-books.ts` (or the admin "Warm book covers" button). This populates `public.books` rows and the `covers` bucket.
4. Deploy. The old `lib/data/shelf-cache.json` is no longer read; it can remain on disk as a legacy artifact.

## Risks / notes

- **Open Library placeholder detection** relies on a `content-length > 1000` heuristic. If Open Library changes the placeholder size, a bad cover could sneak through; mitigated by also checking `content-type` starts with `image/` and by the admin preview showing the mirrored thumbnail so a bad cover is visually caught.
- **Initial cold state**: if a new ISBN is saved to the shelf without warming, the homepage shows an ISBN-labelled chip until the admin warms. The admin workflow (preview before save) makes this rare; the editor status row makes it visible.
- **Storage size**: negligible — ~5 books, ~50KB each.