# Book Cover Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror book covers into Supabase Storage + a `public.books` metadata table, warmed admin-only, so the production build never calls Google Books and visitors always load covers from a Supabase https URL.

**Architecture:** Admin warming fetches Google Books metadata + a larger cover (Google `zoom=0` first, Open Library `-L.jpg` fallback), downloads the bytes, uploads to a `covers` Storage bucket, and upserts a `public.books` row. The homepage `resolveShelf` reads `public.books` in one query and maps rows onto shelf entries; unwarmed ISBNs degrade to ISBN-labelled chips with an actionable error. Google Books/Open Library are never contacted at build or view time.

**Tech Stack:** Next.js 16 (App Router, server actions), TypeScript, `@supabase/ssr` + `@supabase/supabase-js`, Vitest, Fraunces/Nunito CSS tokens in `app/globals.css`.

## Global Constraints

- Cover sources, in priority order: Google Books cover URL upgraded to https with `zoom=0` (replacing current `zoom=1`); then Open Library `https://covers.openlibrary.org/b/isbn/{isbn13}-L.jpg`. Reject the Open Library 1×1 "not found" placeholder via `content-length > 1000` bytes plus `content-type` starts with `image/`.
- Staleness window: 30 days. A `public.books` row is "stale" when `last_fetched_at < now() - 30d`.
- Empty/invalid ISBNs are normalized + validated before any fetch; invalid/empty ISBNs are reported, never fetched.
- Writes to `public.books` and the `covers` bucket go through the service role (`createServiceClient()` from `lib/supabase/server.ts`), matching the existing `public.bench` pattern. The `covers` bucket is public-read so the browser loads images directly.
- `next.config.ts` already sets `images: { unoptimized: true }` globally — do not add `remotePatterns`; keep using `unoptimized` on every `next/image`.
- CSS must use the existing Fraunces/Nunito tokens in `app/globals.css` (e.g. `var(--sage)`, `var(--terracotta-d)`, `var(--walnut-soft)`, `var(--dusk)`, `var(--line)`, `var(--bg-card)`, `var(--bg-card-hi)`, `var(--radius)`). No new fonts, no hardcoded colors.
- Verify mobile at 390 px by inspection after UI changes.
- All work is in `my-app/` unless a path says otherwise. Run commands from `my-app/`.
- Commit after each task. End commit messages with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Shared types (defined in Task 2 and Task 4; referenced by all later tasks)

`BookRow` (DB row, snake_case — defined in `my-app/lib/db/books.ts`):
```ts
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
```

`Book` (camelCase, used by the app — defined in `my-app/lib/books.ts`, extended in Task 4):
```ts
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
```

`WarmResult` (defined in `my-app/lib/books.ts`, Task 4):
```ts
export type WarmStatus = "warmed" | "skipped" | "no-cover" | "error";
export interface WarmResult {
  isbn13: string;
  status: WarmStatus;
  error?: string;
}
```

`BookStatus` (defined in `my-app/app/admin/bench/actions.ts`, Task 5):
```ts
export type BookStatusCode = "warmed" | "stale" | "missing" | "no-cover";
export interface BookStatus {
  isbn13: string;
  status: BookStatusCode;
  hasCover: boolean;
  lastFetchedAt: string | null;
  coverUrl: string | null;
}
```

---

### Task 1: Schema — `public.books` table + `covers` bucket

**Files:**
- Modify: `my-app/lib/db/schema.sql` (append after the existing `public.bench` block, which ends at line 141)

**Interfaces:**
- Produces: a `public.books` table with columns matching `BookRow` (snake_case), and a public `covers` Storage bucket with public-read + authenticated write policies mirroring the existing `blog-assets` block (schema.sql lines 67–131).

- [ ] **Step 1: Append the `public.books` table**

Add to the end of `my-app/lib/db/schema.sql`:

```sql

-- 8. Book metadata + mirrored cover pointers. Service-role only (like bench).
CREATE TABLE IF NOT EXISTS public.books (
  isbn13           text PRIMARY KEY,
  google_books_id  text,
  title            text NOT NULL,
  subtitle         text,
  authors          text[] NOT NULL DEFAULT '{}',
  publisher        text,
  published_date   text,
  page_count       int,
  info_link        text,
  isbn10           text,
  cover_url        text,
  cover_source     text,
  has_cover        boolean NOT NULL DEFAULT false,
  last_fetched_at  timestamptz,
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Append the `covers` bucket and policies**

Append to `my-app/lib/db/schema.sql`:

```sql

-- 9. Storage bucket for mirrored book covers. Public read (browser <img>),
-- authenticated writes (admin warming path).
INSERT INTO storage.buckets (id, name, public)
VALUES ('covers', 'covers', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Public read access for covers'
  ) THEN
    CREATE POLICY "Public read access for covers"
      ON storage.objects
      FOR SELECT
      TO anon, authenticated
      USING (bucket_id = 'covers');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated upload for covers'
  ) THEN
    CREATE POLICY "Authenticated upload for covers"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'covers');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated update for covers'
  ) THEN
    CREATE POLICY "Authenticated update for covers"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (bucket_id = 'covers')
      WITH CHECK (bucket_id = 'covers');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated delete for covers'
  ) THEN
    CREATE POLICY "Authenticated delete for covers"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = 'covers');
  END IF;
END $$;
```

- [ ] **Step 3: Verify the SQL parses (no execution yet)**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && node -e "require('fs').readFileSync('lib/db/schema.sql','utf8'); console.log('schema.sql readable, length ok')"`
Expected: `schema.sql readable, length ok`

- [ ] **Step 4: Commit**

```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
git add my-app/lib/db/schema.sql
git commit -m "feat(schema): add public.books table and covers storage bucket"
```

---

### Task 2: `lib/db/books.ts` — Supabase data layer

**Files:**
- Create: `my-app/lib/db/books.ts`
- Test: `my-app/tests/unit/db-books.test.ts`

**Interfaces:**
- Consumes: `createServiceClient()` from `@/lib/supabase/server` (returns a supabase-js client with storage support).
- Produces:
  - `BookRow` (see Shared types above)
  - `getBooksByIsbns(isbns: string[]): Promise<Map<string, BookRow>>`
  - `upsertBook(row: BookRow): Promise<void>`
  - `mirrorCover(isbn13: string, bytes: Buffer, mimeType: string): Promise<string>` — uploads to `covers/{isbn13}.{ext}`, returns the public URL.
  - `bookRowToBook(row: BookRow): Book` (camelCase mapping; `Book` imported from `@/lib/books`)
  - `STALE_AFTER_DAYS = 30` and `isStale(lastFetchedAt: string | null): boolean`

- [ ] **Step 1: Write the failing test**

Create `my-app/tests/unit/db-books.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
const inMock = vi.fn();
const eqMock = vi.fn();
const singleMock = vi.fn();
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
  eqMock.mockReset();
  singleMock.mockReset();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npx vitest run tests/unit/db-books.test.ts`
Expected: FAIL — module `@/lib/db/books` does not exist.

- [ ] **Step 3: Write the implementation**

Create `my-app/lib/db/books.ts`:

```ts
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

export function bookRowToBook(row: BookRow): Book {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npx vitest run tests/unit/db-books.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
git add my-app/lib/db/books.ts my-app/tests/unit/db-books.test.ts
git commit -m "feat(db): add Supabase data layer for books + cover mirroring"
```

---

### Task 3: `lib/covers.ts` — cover source resolution

**Files:**
- Create: `my-app/lib/covers.ts`
- Test: `my-app/tests/unit/covers.test.ts`

**Interfaces:**
- Consumes: `Book` from `@/lib/books` (uses `book.googleBooksId`, `book.isbn13`).
- Produces:
  - `CoverResult = { bytes: Buffer; mimeType: string; source: "google" | "openlibrary" }`
  - `fetchCoverBytes(book: Pick<Book, "googleBooksId" | "isbn13">): Promise<CoverResult | null>`

- [ ] **Step 1: Write the failing test**

Create `my-app/tests/unit/covers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchCoverBytes } from "@/lib/covers";

const BOOK = { googleBooksId: "yoHbJ78JZCYC", isbn13: "9780307473394" };

describe("fetchCoverBytes", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  function imageResponse(bytes: number[], mimeType = "image/jpeg", status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? mimeType : null,
      },
      arrayBuffer: async () => new ArrayBuffer(bytes.length),
      // covers.ts uses .arrayBuffer() then Buffer.from; emulate byte length
      bytes: async () => Uint8Array.from(bytes),
    } as unknown as Response;
  }

  it("tries the Google zoom=0 https URL first and returns its bytes", async () => {
    const fakeBytes = Array.from({ length: 4000 }, (_, i) => i % 256);
    vi.mocked(fetch).mockResolvedValue(imageResponse(fakeBytes, "image/jpeg"));

    const result = await fetchCoverBytes(BOOK);
    expect(result?.source).toBe("google");
    expect(result?.mimeType).toBe("image/jpeg");
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("https://books.google.com/books/content");
    expect(url).toContain("id=yoHbJ78JZCYC");
    expect(url).toContain("zoom=0");
  });

  it("falls back to Open Library when Google returns a non-image / 404", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404, headers: { get: () => null } } as unknown as Response)
      .mockResolvedValueOnce(imageResponse(Array.from({ length: 5000 }, () => 1), "image/jpeg"));

    const result = await fetchCoverBytes(BOOK);
    expect(result?.source).toBe("openlibrary");
    const olUrl = vi.mocked(fetch).mock.calls[1][0] as string;
    expect(olUrl).toBe("https://covers.openlibrary.org/b/isbn/9780307473394/L.jpg");
  });

  it("rejects the Open Library 1x1 not-found placeholder (<1000 bytes)", async () => {
    const tiny = Array.from({ length: 800 }, () => 0);
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404, headers: { get: () => null } } as unknown as Response)
      .mockResolvedValueOnce(imageResponse(tiny, "image/jpeg"));

    const result = await fetchCoverBytes(BOOK);
    expect(result).toBeNull();
  });

  it("returns null when both sources fail", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, headers: { get: () => null } } as unknown as Response);
    const result = await fetchCoverBytes(BOOK);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npx vitest run tests/unit/covers.test.ts`
Expected: FAIL — module `@/lib/covers` does not exist.

- [ ] **Step 3: Write the implementation**

Create `my-app/lib/covers.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npx vitest run tests/unit/covers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
git add my-app/lib/covers.ts my-app/tests/unit/covers.test.ts
git commit -m "feat(covers): resolve covers from Google zoom=0 with Open Library fallback"
```

---

### Task 4: `lib/books.ts` — extend `Book`, add `warmBook`, rewrite `resolveShelf`

**Files:**
- Modify: `my-app/lib/books.ts` (rewrite `resolveShelf`, extend `Book`, add `warmBook` + `warmBookToRow` helper; keep `fetchByIsbn`, `parseBook`, `fetchBookByIsbn`, `loadShelf`, `ShelfEntry`/`ShelfData`/`VaultData`/`ShelfError`/`ResolvedShelf`)
- Test: `my-app/tests/unit/books.test.ts` (rewrite the `resolveShelf` block; keep ISBN + `fetchBookByIsbn` blocks; add `warmBook` block)

**Interfaces:**
- Consumes: `getBooksByIsbns`, `upsertBook`, `mirrorCover`, `bookRowToBook`, `isStale`, `BookRow` from `@/lib/db/books`; `fetchCoverBytes` from `@/lib/covers`; `normalizeIsbn13`, `isValidIsbn13` from `@/lib/isbn`.
- Produces:
  - `Book` extended with `coverUrl` + `coverSource` (see Shared types)
  - `WarmStatus`, `WarmResult` (see Shared types)
  - `warmBook(isbn13: string, opts?: { force?: boolean }): Promise<WarmResult>`
  - `resolveShelf(shelf: ShelfData): Promise<ResolvedShelf>` — now reads Supabase only
  - `warmBookToRow(book: Book, cover: { coverUrl: string | null; coverSource: "google" | "openlibrary" | null; hasCover: boolean }): BookRow`

- [ ] **Step 1: Rewrite the `resolveShelf` + `warmBook` tests**

This step makes four edits to `my-app/tests/unit/books.test.ts`.

**Edit 1a — add mocks at the top of the file.** Immediately after the existing `import { ... } from "@/lib/books"` line (line 7), add these top-level mocks (vitest hoists them above imports regardless, but keep them near the top for readability):

```ts
vi.mock("@/lib/db/books", () => ({
  getBooksByIsbns: vi.fn(),
  upsertBook: vi.fn(),
  mirrorCover: vi.fn(),
  bookRowToBook: vi.fn(),
  isStale: vi.fn(),
}));

vi.mock("@/lib/covers", () => ({
  fetchCoverBytes: vi.fn(),
}));
```

**Edit 1b — extend the `@/lib/books` import** to include `warmBook` and the `Book` type. Replace the existing import (lines 2–7):

```ts
import {
  isValidIsbn13,
  normalizeIsbn13,
  fetchBookByIsbn,
  resolveShelf,
} from "@/lib/books"
```

with:

```ts
import {
  isValidIsbn13,
  normalizeIsbn13,
  fetchBookByIsbn,
  resolveShelf,
  warmBook,
  type Book,
} from "@/lib/books"

import {
  getBooksByIsbns,
  upsertBook,
  mirrorCover,
  bookRowToBook,
  isStale,
} from "@/lib/db/books";
import { fetchCoverBytes } from "@/lib/covers";
```

**Edit 1c — replace the entire `describe("resolveShelf", ...)` block** (the original lines 126–189) with the new `resolveShelf` + `warmBook` describe blocks below. (The `warmBook` block goes at the end of the file, after `resolveShelf`.)

```ts
describe("resolveShelf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_BOOKS_API_KEY = "test-key";
  });
  afterEach(() => vi.restoreAllMocks());

  it("resolves entries from Supabase books without calling Google Books", async () => {
    const row = {
      isbn13: "9780307473394",
      google_books_id: "g1",
      title: "Running Book",
      subtitle: null,
      authors: ["A Runner"],
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
    };
    vi.mocked(getBooksByIsbns).mockResolvedValue(new Map([["9780307473394", row]]));
    vi.mocked(bookRowToBook).mockImplementation((r) => ({
      googleBooksId: r.google_books_id ?? r.isbn13,
      title: r.title,
      subtitle: r.subtitle,
      authors: r.authors,
      publisher: r.publisher,
      publishedDate: r.published_date,
      pageCount: r.page_count,
      infoLink: r.info_link,
      thumbnail: null,
      isbn13: r.isbn13,
      isbn10: r.isbn10,
      coverUrl: r.cover_url,
      coverSource: r.cover_source,
    }));

    const shelf = {
      currentlyReading: [{ isbn13: "9780307473394", note: "n1" }],
      tbr: [{ isbn13: "9780307473394", note: "n2" }],
    };
    const resolved = await resolveShelf(shelf);

    expect(getBooksByIsbns).toHaveBeenCalledWith(["9780307473394", "9780307473394"]);
    expect(resolved.currentlyReading[0].title).toBe("Running Book");
    expect(resolved.currentlyReading[0].coverUrl).toBe("https://supabase.example/covers/9780307473394.jpg");
    expect(resolved.tbr[0].note).toBe("n2");
    expect(resolved.errors).toHaveLength(0);
  });

  it("reports unwarmed ISBNs as errors and renders degraded chips", async () => {
    vi.mocked(getBooksByIsbns).mockResolvedValue(new Map());
    globalThis.fetch = vi.fn();

    const shelf = {
      currentlyReading: [{ isbn13: "9780307473394", note: "note" }],
      tbr: [],
    };
    const resolved = await resolveShelf(shelf);

    expect(resolved.currentlyReading[0].title).toBe("9780307473394");
    expect(resolved.currentlyReading[0].coverUrl).toBeNull();
    expect(resolved.errors).toHaveLength(1);
    expect(resolved.errors[0].reason).toContain("Not warmed yet");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("warmBook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_BOOKS_API_KEY = "test-key";
    globalThis.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  const fullBook: Book = {
    googleBooksId: "g1",
    title: "Running",
    subtitle: null,
    authors: ["Haruki Murakami"],
    publisher: null,
    publishedDate: null,
    pageCount: null,
    infoLink: null,
    thumbnail: "http://books.google.com/books/content?id=g1&zoom=1",
    isbn13: "9780307473394",
    isbn10: null,
    coverUrl: null,
    coverSource: null,
  };

  // Real fetchBookByIsbn drives globalThis.fetch; this stubs the Google Books JSON.
  function googleBooksResponse(book: Book) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: book.googleBooksId,
            volumeInfo: {
              title: book.title,
              subtitle: book.subtitle,
              authors: book.authors,
              publisher: book.publisher,
              publishedDate: book.publishedDate,
              pageCount: book.pageCount,
              infoLink: book.infoLink,
              imageLinks: { thumbnail: book.thumbnail },
              industryIdentifiers: [
                { type: "ISBN_13", identifier: book.isbn13 ?? "" },
              ],
            },
          },
        ],
      }),
    } as Response;
  }

  it("reports error for an invalid ISBN without fetching", async () => {
    const result = await warmBook("not-an-isbn");
    expect(result.status).toBe("error");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("skips a fresh, covered row when force is false", async () => {
    vi.mocked(getBooksByIsbns).mockResolvedValue(
      new Map([
        [
          "9780307473394",
          {
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
            last_fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      ])
    );
    vi.mocked(isStale).mockReturnValue(false);

    const result = await warmBook("9780307473394");
    expect(result.status).toBe("skipped");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("warms a book: fetches metadata, mirrors cover, upserts row", async () => {
    vi.mocked(getBooksByIsbns).mockResolvedValue(new Map());
    vi.mocked(fetch).mockResolvedValue(googleBooksResponse(fullBook));
    vi.mocked(fetchCoverBytes).mockResolvedValue({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "image/jpeg",
      source: "google",
    });
    vi.mocked(mirrorCover).mockResolvedValue("https://supabase.example/covers/9780307473394.jpg");
    vi.mocked(upsertBook).mockResolvedValue(undefined);

    const result = await warmBook("9780307473394");
    expect(result.status).toBe("warmed");
    expect(mirrorCover).toHaveBeenCalledWith("9780307473394", expect.any(Buffer), "image/jpeg");
    expect(upsertBook).toHaveBeenCalled();
    const row = vi.mocked(upsertBook).mock.calls[0][0];
    expect(row.cover_url).toBe("https://supabase.example/covers/9780307473394.jpg");
    expect(row.has_cover).toBe(true);
  });

  it("returns no-cover when neither source yields a cover", async () => {
    vi.mocked(getBooksByIsbns).mockResolvedValue(new Map());
    vi.mocked(fetch).mockResolvedValue(googleBooksResponse(fullBook));
    vi.mocked(fetchCoverBytes).mockResolvedValue(null);
    vi.mocked(upsertBook).mockResolvedValue(undefined);

    const result = await warmBook("9780307473394");
    expect(result.status).toBe("no-cover");
    const row = vi.mocked(upsertBook).mock.calls[0][0];
    expect(row.has_cover).toBe(false);
    expect(row.cover_url).toBeNull();
  });

  it("returns error when Google Books metadata fetch fails", async () => {
    vi.mocked(getBooksByIsbns).mockResolvedValue(new Map());
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);

    const result = await warmBook("9780307473394");
    expect(result.status).toBe("error");
    expect(mirrorCover).not.toHaveBeenCalled();
  });
});
```

Add `fetchCoverBytes` to the imports from `@/lib/covers` (mock it). To mock `@/lib/covers`, add near the other `vi.mock` calls at the top of the file, after the `@/lib/db/books` mock:

```ts
vi.mock("@/lib/covers", () => ({
  fetchCoverBytes: vi.fn(),
}));
```

And update the top-of-file import list to include `warmBook` and `Book`:

```ts
import {
  isValidIsbn13,
  normalizeIsbn13,
  fetchBookByIsbn,
  resolveShelf,
  warmBook,
  type Book,
} from "@/lib/books"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npx vitest run tests/unit/books.test.ts`
Expected: FAIL — `resolveShelf` still calls Google Books; `warmBook` not exported.

- [ ] **Step 3: Rewrite `lib/books.ts`**

Replace the full contents of `my-app/lib/books.ts` with:

```ts
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
```

Note: `loadCache()` and the `shelf-cache.json` read path are removed. The `lib/data/shelf-cache.json` file stays on disk but is no longer referenced.

- [ ] **Step 4: Run the full books test file to verify it passes**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npx vitest run tests/unit/books.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
git add my-app/lib/books.ts my-app/tests/unit/books.test.ts
git commit -m "feat(books): resolve shelf from Supabase, add warmBook + cover mirroring"
```

---

### Task 5: Admin actions — `warmBooksAction`, warming `previewBookAction`, `listBookStatusesAction`

**Files:**
- Modify: `my-app/app/admin/bench/actions.ts`
- Test: `my-app/tests/unit/bench-actions.test.ts` (rewrite)

**Interfaces:**
- Consumes: `loadShelf` from `@/lib/db/bench`; `warmBook`, `fetchBookByIsbn`, `getBooksByIsbns`-derived statuses from `@/lib/books` + `@/lib/db/books`; `requireAdmin` from `@/lib/auth`.
- Produces:
  - `warmBooksAction(opts?: { force?: boolean }): Promise<{ success: true; results: WarmResult[]; statuses: BookStatus[] } | { success: false; error: string }>`
  - `previewBookAction(isbn13: string): Promise<{ success: true; book: Book } | { success: false; error: string }>` — now warms too.
  - `listBookStatusesAction(isbns: string[]): Promise<BookStatus[]>`
  - `BookStatus`, `BookStatusCode` (see Shared types)

- [ ] **Step 1: Rewrite the bench-actions test**

Replace the full contents of `my-app/tests/unit/bench-actions.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({
    id: "admin-1",
    email: "admin@example.com",
  }),
}));

vi.mock("@/lib/db/bench", () => ({
  loadShelf: vi.fn(),
  loadVault: vi.fn(),
  saveShelf: vi.fn(),
  saveVault: vi.fn(),
}));

vi.mock("@/lib/db/books", () => ({
  getBooksByIsbns: vi.fn(),
  isStale: vi.fn(),
}));

vi.mock("@/lib/books", () => ({
  warmBook: vi.fn(),
  fetchBookByIsbn: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  loadBenchData,
  saveShelfAction,
  saveVaultAction,
  warmBooksAction,
  previewBookAction,
  listBookStatusesAction,
} from "@/app/admin/bench/actions";
import * as bench from "@/lib/db/bench";
import * as dbBooks from "@/lib/db/books";
import * as books from "@/lib/books";
import { revalidatePath } from "next/cache";

const fullBook = {
  googleBooksId: "g1",
  title: "Preview Book",
  subtitle: null,
  authors: ["Author"],
  publisher: null,
  publishedDate: null,
  pageCount: null,
  infoLink: null,
  thumbnail: null,
  isbn13: "9780307473394",
  isbn10: null,
  coverUrl: "https://supabase.example/covers/9780307473394.jpg",
  coverSource: "google" as const,
};

describe("bench admin actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loadBenchData returns shelf and vault from the data layer", async () => {
    const shelf = { currentlyReading: [], tbr: [] };
    const vault = { clips: [] };
    vi.mocked(bench.loadShelf).mockResolvedValue(shelf);
    vi.mocked(bench.loadVault).mockResolvedValue(vault);

    const result = await loadBenchData();
    expect(result.shelf).toBe(shelf);
    expect(result.vault).toBe(vault);
  });

  it("saveShelfAction persists shelf and revalidates", async () => {
    const shelf = {
      currentlyReading: [{ isbn13: "9780307473394", note: "Running book" }],
      tbr: [],
    };
    const result = await saveShelfAction(shelf);
    expect(result).toEqual({ success: true });
    expect(bench.saveShelf).toHaveBeenCalledWith(shelf);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("saveShelfAction returns an error when persistence fails", async () => {
    vi.mocked(bench.saveShelf).mockRejectedValue(new Error("DB unavailable"));
    const result = await saveShelfAction({ currentlyReading: [], tbr: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("DB unavailable");
  });

  it("saveVaultAction persists vault and revalidates", async () => {
    const vault = {
      clips: [
        { title: "Clip", url: "https://example.com", source: "blog", date: "1d ago", note: "" },
      ],
    };
    const result = await saveVaultAction(vault);
    expect(result).toEqual({ success: true });
    expect(bench.saveVault).toHaveBeenCalledWith(vault);
  });

  it("warmBooksAction warms valid ISBNs and skips invalid ones", async () => {
    const shelf = {
      currentlyReading: [
        { isbn13: "9780307473394", note: "n1" },
        { isbn13: "not-an-isbn", note: "bad" },
      ],
      tbr: [],
    };
    vi.mocked(bench.loadShelf).mockResolvedValue(shelf);
    vi.mocked(books.warmBook)
      .mockResolvedValueOnce({ isbn13: "9780307473394", status: "warmed" })
      .mockResolvedValueOnce({ isbn13: "not-an-isbn", status: "error", error: "Invalid ISBN-13" });
    vi.mocked(dbBooks.getBooksByIsbns).mockResolvedValue(new Map());

    const result = await warmBooksAction();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe("warmed");
    expect(result.results[1].status).toBe("error");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("warmBooksAction forces re-warm when force=true", async () => {
    const shelf = {
      currentlyReading: [{ isbn13: "9780307473394", note: "n1" }],
      tbr: [],
    };
    vi.mocked(bench.loadShelf).mockResolvedValue(shelf);
    vi.mocked(books.warmBook).mockResolvedValue({ isbn13: "9780307473394", status: "warmed" });
    vi.mocked(dbBooks.getBooksByIsbns).mockResolvedValue(new Map());

    await warmBooksAction({ force: true });
    expect(books.warmBook).toHaveBeenCalledWith("9780307473394", { force: true });
  });

  it("warmBooksAction returns an error when loadShelf throws", async () => {
    vi.mocked(bench.loadShelf).mockRejectedValue(new Error("no shelf"));
    const result = await warmBooksAction();
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe("no shelf");
  });

  it("previewBookAction warms and returns the book for a valid ISBN", async () => {
    vi.mocked(books.warmBook).mockResolvedValue({ isbn13: "9780307473394", status: "warmed" });
    vi.mocked(books.fetchBookByIsbn).mockResolvedValue(fullBook);
    vi.mocked(dbBooks.getBooksByIsbns).mockResolvedValue(
      new Map([
        [
          "9780307473394",
          {
            isbn13: "9780307473394",
            google_books_id: "g1",
            title: "Preview Book",
            subtitle: null,
            authors: [],
            publisher: null,
            published_date: null,
            page_count: null,
            info_link: null,
            isbn10: null,
            cover_url: "https://supabase.example/covers/9780307473394.jpg",
            cover_source: "google",
            has_cover: true,
            last_fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      ])
    );

    const result = await previewBookAction("9780307473394");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.book.title).toBe("Preview Book");
    expect(result.book.coverUrl).toBe("https://supabase.example/covers/9780307473394.jpg");
    expect(books.warmBook).toHaveBeenCalledWith("9780307473394");
  });

  it("previewBookAction returns an error when warming fails", async () => {
    vi.mocked(books.warmBook).mockResolvedValue({
      isbn13: "9780307473394",
      status: "error",
      error: "Not found in Google Books",
    });
    const result = await previewBookAction("9780307473394");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("No book found");
  });

  it("listBookStatusesAction maps rows to statuses", async () => {
    vi.mocked(dbBooks.getBooksByIsbns).mockResolvedValue(
      new Map([
        [
          "9780307473394",
          {
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
            last_fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      ])
    );
    vi.mocked(dbBooks.isStale).mockReturnValue(false);

    const statuses = await listBookStatusesAction(["9780307473394", "0000000000invalid"]);
    // invalid ISBN is filtered out by listBookStatusesAction, so only the valid one returns
    expect(statuses).toHaveLength(1);
    expect(statuses[0].status).toBe("warmed");
    expect(statuses[0].hasCover).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npx vitest run tests/unit/bench-actions.test.ts`
Expected: FAIL — `warmBooksAction`, `listBookStatusesAction` not exported; `refreshCacheAction` still present.

- [ ] **Step 3: Rewrite `app/admin/bench/actions.ts`**

Replace the full contents of `my-app/app/admin/bench/actions.ts` with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  ShelfData,
  VaultData,
  warmBook,
  fetchBookByIsbn,
  Book,
  WarmResult,
} from "@/lib/books";
import { isValidIsbn13, normalizeIsbn13 } from "@/lib/isbn";
import { loadShelf, loadVault, saveShelf, saveVault } from "@/lib/db/bench";
import {
  getBooksByIsbns,
  isStale,
  type BookRow,
} from "@/lib/db/books";

export type BookStatusCode = "warmed" | "stale" | "missing" | "no-cover";
export interface BookStatus {
  isbn13: string;
  status: BookStatusCode;
  hasCover: boolean;
  lastFetchedAt: string | null;
  coverUrl: string | null;
}

export async function loadBenchData(): Promise<{
  shelf: ShelfData;
  vault: VaultData;
}> {
  await requireAdmin();
  const [shelf, vault] = await Promise.all([loadShelf(), loadVault()]);
  return { shelf, vault };
}

export async function saveShelfAction(
  shelf: ShelfData
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    await saveShelf(shelf);
    revalidatePath("/");
    revalidatePath("/admin/bench");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save shelf";
    return { success: false, error: message };
  }
}

export async function saveVaultAction(
  vault: VaultData
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    await saveVault(vault);
    revalidatePath("/");
    revalidatePath("/admin/bench");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save vault";
    return { success: false, error: message };
  }
}

function uniqueValidIsbns(shelf: ShelfData): { isbns: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const isbns: string[] = [];
  const invalid: string[] = [];
  for (const entry of [...shelf.currentlyReading, ...shelf.tbr]) {
    const cleaned = normalizeIsbn13(entry.isbn13);
    if (!isValidIsbn13(cleaned)) {
      invalid.push(entry.isbn13 || "(empty)");
      continue;
    }
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      isbns.push(cleaned);
    }
  }
  return { isbns, invalid };
}

export async function warmBooksAction(
  opts: { force?: boolean } = {}
): Promise<
  | { success: true; results: WarmResult[]; statuses: BookStatus[] }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const shelf = await loadShelf();
    const { isbns, invalid } = uniqueValidIsbns(shelf);

    const results: WarmResult[] = [];
    for (const isbn of isbns) {
      const result = await warmBook(isbn, opts);
      results.push(result);
      // Small stagger to avoid hammering Google Books.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    for (const bad of invalid) {
      results.push({ isbn13: bad, status: "error", error: "Invalid ISBN-13" });
    }

    const statuses = await listBookStatusesAction(isbns);
    revalidatePath("/");
    revalidatePath("/admin/bench");
    return { success: true, results, statuses };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to warm books";
    return { success: false, error: message };
  }
}

export async function previewBookAction(
  isbn13: string
): Promise<{ success: true; book: Book } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const warm = await warmBook(isbn13);
    if (warm.status === "error") {
      return {
        success: false,
        error: warm.error?.includes("Invalid")
          ? "Enter a valid ISBN-13 first"
          : "No book found. Check the ISBN-13 and API key.",
      };
    }
    const book = await fetchBookByIsbn(isbn13);
    if (!book) {
      return { success: false, error: "No book found. Check the ISBN-13 and API key." };
    }
    // After warming, fetch the row so the preview shows the mirrored cover URL.
    const rows = await getBooksByIsbns([normalizeIsbn13(isbn13)]);
    const row = rows.get(normalizeIsbn13(isbn13));
    return {
      success: true,
      book: {
        ...book,
        coverUrl: row?.cover_url ?? null,
        coverSource: row?.cover_source ?? null,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to preview book";
    return { success: false, error: message };
  }
}

function rowToStatus(isbn13: string, row: BookRow | undefined): BookStatus {
  if (!row) {
    return { isbn13, status: "missing", hasCover: false, lastFetchedAt: null, coverUrl: null };
  }
  if (!row.has_cover) return { isbn13, status: "no-cover", hasCover: false, lastFetchedAt: row.last_fetched_at, coverUrl: row.cover_url };
  if (isStale(row.last_fetched_at)) {
    return { isbn13, status: "stale", hasCover: true, lastFetchedAt: row.last_fetched_at, coverUrl: row.cover_url };
  }
  return { isbn13, status: "warmed", hasCover: true, lastFetchedAt: row.last_fetched_at, coverUrl: row.cover_url };
}

export async function listBookStatusesAction(
  isbns: string[]
): Promise<BookStatus[]> {
  await requireAdmin();
  const valid = isbns
    .map((i) => normalizeIsbn13(i))
    .filter((i) => i !== "" && isValidIsbn13(i));
  const rows = await getBooksByIsbns(valid);
  return valid.map((isbn) => rowToStatus(isbn, rows.get(isbn)));
}
```

- [ ] **Step 4: Run the bench-actions test to verify it passes**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npx vitest run tests/unit/bench-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npm test`
Expected: PASS (all unit tests green).

- [ ] **Step 6: Commit**

```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
git add my-app/app/admin/bench/actions.ts my-app/tests/unit/bench-actions.test.ts
git commit -m "feat(admin): warmBooksAction + warming previewBookAction + listBookStatusesAction"
```

---

### Task 6: `scripts/warm-books.ts` — CLI warmer

**Files:**
- Create: `my-app/scripts/warm-books.ts`
- Modify: `my-app/package.json` (add `warm-books` script)

**Interfaces:**
- Consumes: `loadShelf` from `@/lib/db/bench`; `warmBook` from `@/lib/books`; `normalizeIsbn13`, `isValidIsbn13` from `@/lib/isbn`; `dotenv` for `.env.local` loading. (`loadShelf` and `warmBook` create their own Supabase service clients internally.)

- [ ] **Step 1: Create the warmer script**

Create `my-app/scripts/warm-books.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { loadShelf } from "@/lib/db/bench";
import { warmBook } from "@/lib/books";
import { normalizeIsbn13, isValidIsbn13 } from "@/lib/isbn";

async function main() {
  const force = process.argv.includes("--force");
  const shelf = await loadShelf();
  const entries = [...shelf.currentlyReading, ...shelf.tbr];
  const seen = new Set<string>();

  for (const entry of entries) {
    const isbn = normalizeIsbn13(entry.isbn13);
    if (!isValidIsbn13(isbn)) {
      console.warn(`SKIP  ${entry.isbn13 || "(empty)"} — invalid ISBN`);
      continue;
    }
    if (seen.has(isbn)) continue;
    seen.add(isbn);

    console.log(`WARM  ${isbn} …`);
    const result = await warmBook(isbn, { force });
    console.log(`  -> ${result.status}${result.error ? ` (${result.error})` : ""}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`loadShelf` and `warmBook` both call `createServiceClient()` internally, which reads `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env (loaded by `dotenv` at the top). No standalone supabase client is needed here, unlike `seed-bench.ts` which wrote to the `bench` table directly.

- [ ] **Step 2: Add the npm script**

In `my-app/package.json`, inside the `"scripts"` object, change the `"test:watch": "vitest"` line to:

```json
    "test:watch": "vitest",
    "warm-books": "tsx scripts/warm-books.ts"
```

(`tsx` is already a devDependency and respects the tsconfig `@/*` path alias, so the script's `@/lib/...` imports resolve. The script loads `.env.local` itself via `dotenv`.)

- [ ] **Step 3: Verify the script type-checks / resolves**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npx tsc --noEmit scripts/warm-books.ts 2>&1 | head -20`
Expected: no errors (or only path-alias notes if tsconfig paths aren't picked up by file-scoped tsc — if so, run `npx next build` dry-check is not needed; a clean typecheck of the whole project is covered in Task 10).

- [ ] **Step 4: Commit**

```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
git add my-app/scripts/warm-books.ts my-app/package.json
git commit -m "feat(scripts): add warm-books CLI for initial seeding"
```

---

### Task 7: `BenchEditor.tsx` — warm button + per-ISBN status + cover thumbnails

**Files:**
- Modify: `my-app/components/BenchEditor.tsx`
- Modify: `my-app/app/admin/bench/page.tsx` (pass `warmBooks`, `listBookStatuses`/`initialBookStatuses`)
- Modify: `my-app/app/globals.css` (add status badge + thumbnail styles using existing tokens)

**Interfaces:**
- Consumes: `BookStatus` from `@/app/admin/bench/actions`; `warmBooksAction`, `listBookStatusesAction` server actions; `Book` from `@/lib/books`.

- [ ] **Step 1: Add the status badge + thumbnail styles to `globals.css`**

Append to `my-app/app/globals.css` (use existing tokens; no new fonts/colors):

```css
/* Bench editor: per-ISBN warm status + cover thumbnail */
.bench-status-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: var(--walnut-soft);
}
.bench-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.5rem;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--bg-card);
  font-weight: 600;
  white-space: nowrap;
}
.bench-status-badge.warmed { color: var(--sage-deep); border-color: var(--sage); }
.bench-status-badge.stale  { color: var(--dusk); border-color: var(--line); }
.bench-status-badge.missing { color: var(--terracotta-d); border-color: var(--terracotta); }
.bench-status-badge.no-cover { color: var(--dusk); border-color: var(--line); }
.bench-status-badge.invalid { color: var(--terracotta-d); border-color: var(--terracotta); }
.bench-status-thumb {
  width: 28px;
  height: 42px;
  border-radius: 2px;
  object-fit: cover;
  border: 1px solid var(--line);
  background: var(--bg-card-hi);
}
.bench-status-date { color: var(--dusk); font-size: 0.7rem; }
```

- [ ] **Step 2: Update `BenchEditor.tsx` props + state**

In `my-app/components/BenchEditor.tsx`:

Replace the `BenchEditorProps` interface (lines 9–24) with:

```ts
import type { ShelfData, VaultData, Book } from "@/lib/books";
import type { BookStatus } from "@/app/admin/bench/actions";
import { isValidIsbn13, normalizeIsbn13 } from "@/lib/isbn";
import { formatRelativeDate } from "@/lib/date";

interface BenchEditorProps {
  initialShelf: ShelfData;
  initialVault: VaultData;
  initialBookStatuses: BookStatus[];
  saveShelf: (
    shelf: ShelfData
  ) => Promise<{ success: true } | { success: false; error: string }>;
  saveVault: (
    vault: VaultData
  ) => Promise<{ success: true } | { success: false; error: string }>;
  warmBooks: (
    opts?: { force?: boolean }
  ) => Promise<
    | { success: true; results: { isbn13: string; status: string; error?: string }[]; statuses: BookStatus[] }
    | { success: false; error: string }
  >;
  previewBook: (
    isbn13: string
  ) => Promise<{ success: true; book: Book } | { success: false; error: string }>;
}
```

Remove the old `refreshCache` prop reference. Add state + handlers after the existing `const [touched, setTouched] = ...` line:

```ts
  const [bookStatuses, setBookStatuses] = useState<BookStatus[]>(initialBookStatuses);

  function statusFor(isbn13: string): BookStatus | undefined {
    return bookStatuses.find((s) => s.isbn13 === normalizeIsbn13(isbn13));
  }

  function handleWarmBooks(force: boolean) {
    startTransition(async () => {
      setError("");
      const result = await warmBooks({ force });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setBookStatuses(result.statuses);
      const warmed = result.results.filter((r) => r.status === "warmed").length;
      const errors = result.results.filter((r) => r.status === "error").length;
      showMessage(`Warmed ${warmed} book(s)${errors ? `, ${errors} error(s)` : ""}.`);
    });
  }
```

- [ ] **Step 3: Replace the "Refresh book cache" button**

In `my-app/components/BenchEditor.tsx`, replace the button block (lines 323–331):

```tsx
        <button
          type="button"
          onClick={handleRefreshCache}
          disabled={isPending}
          className="pill cursor-pointer ml-auto"
        >
          {isPending ? "Refreshing…" : "Refresh book cache"}
        </button>
```

with:

```tsx
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={() => handleWarmBooks(false)}
            disabled={isPending}
            className="pill live cursor-pointer"
          >
            {isPending ? "Warming…" : "Warm book covers"}
          </button>
          <button
            type="button"
            onClick={() => handleWarmBooks(true)}
            disabled={isPending}
            className="pill cursor-pointer"
          >
            Re-warm all
          </button>
        </div>
```

Remove the now-unused `handleRefreshCache` function (lines 209–219).

- [ ] **Step 4: Add a per-row status badge inside each book row**

First, add a `BookStatusBadge` component above the `export default function BenchEditor` (place it after the `ValidityHint` function):

```tsx
function BookStatusBadge({
  isbn13,
  status,
}: {
  isbn13: string;
  status: BookStatus | undefined;
}) {
  if (isbn13.trim() !== "" && !isValidIsbn13(isbn13)) {
    return (
      <div className="bench-status-row">
        <span className="bench-status-badge invalid">invalid ISBN</span>
      </div>
    );
  }
  if (!status) return null;
  const label =
    status.status === "warmed" ? "✓ warmed"
    : status.status === "stale" ? "⟳ stale"
    : status.status === "no-cover" ? "⊘ no cover"
    : "⊘ not warmed";
  return (
    <div className="bench-status-row">
      <span className={`bench-status-badge ${status.status}`}>{label}</span>
      {status.coverUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={status.coverUrl} alt="" className="bench-status-thumb" />
      )}
      {status.lastFetchedAt && (
        <span className="bench-status-date">
          warmed {formatRelativeDate(new Date(status.lastFetchedAt))}
        </span>
      )}
    </div>
  );
}
```

Then, inside the `shelf[section].map(...)` return, add a status row immediately after the existing `<BookPreview ... />` wrapper `</div>` (the `<div className="md:col-span-3">` that contains the Preview button + `BookPreview`, around line 446):

```tsx
                        <div className="md:col-span-3">
                          <BookStatusBadge
                            isbn13={book.isbn13}
                            status={statusFor(book.isbn13)}
                          />
                        </div>
```

- [ ] **Step 5: Update the `BookPreview` to prefer the mirrored cover**

In `my-app/components/BenchEditor.tsx`, in `BookPreview`, change the image src from `book.thumbnail` to `book.coverUrl ?? book.thumbnail`. Replace (around line 270):

```tsx
        {book.thumbnail ? (
          <Image
            src={book.thumbnail}
```

with:

```tsx
        {(book.coverUrl ?? book.thumbnail) ? (
          <Image
            src={(book.coverUrl ?? book.thumbnail)!}
```

- [ ] **Step 6: Wire the page to pass `initialBookStatuses` + `warmBooks`**

In `my-app/app/admin/bench/page.tsx`, replace the import + `<BenchEditor>` usage:

```tsx
import {
  loadBenchData,
  saveShelfAction,
  saveVaultAction,
  warmBooksAction,
  previewBookAction,
  listBookStatusesAction,
} from "./actions"
```

And replace the `<BenchEditor ...>` JSX with:

```tsx
        <BenchEditor
          initialShelf={shelf}
          initialVault={vault}
          initialBookStatuses={await listBookStatusesAction([
            ...shelf.currentlyReading.map((e) => e.isbn13),
            ...shelf.tbr.map((e) => e.isbn13),
          ])}
          saveShelf={saveShelfAction}
          saveVault={saveVaultAction}
          warmBooks={warmBooksAction}
          previewBook={previewBookAction}
        />
```

Update the helper description paragraph text from "Refresh the book cache after changing ISBNs." to "Warm book covers after changing ISBNs.".

- [ ] **Step 7: Build to verify the editor compiles**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npm run build`
Expected: build succeeds (may warn about unwarmed books at runtime, but compile must pass).

- [ ] **Step 8: Verify mobile at 390 px by inspection**

Open the admin bench page in the dev server at 390 px width. Confirm: the "Warm book covers" / "Re-warm all" buttons wrap onto their own line and don't overflow; status badges wrap; the cover row + status thumbnails stay single-column. Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npm run dev` and inspect.

- [ ] **Step 9: Commit**

```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
git add my-app/components/BenchEditor.tsx my-app/app/admin/bench/page.tsx my-app/app/globals.css
git commit -m "feat(admin): warm button + per-ISBN status badges + cover thumbnails"
```

---

### Task 8: `BenchOverlay.tsx` — use `coverUrl` + ISBN chip fallback

**Files:**
- Modify: `my-app/components/BenchOverlay.tsx`

**Interfaces:**
- Consumes: `Book` now includes `coverUrl` + `coverSource`.

- [ ] **Step 1: Update the `Cover` component to use `coverUrl`**

In `my-app/components/BenchOverlay.tsx`, in the `Cover` function (around line 89), replace:

```tsx
      {book.thumbnail ? (
        <Image
          src={book.thumbnail}
          alt={book.title}
          width={56}
          height={84}
          unoptimized
        />
      ) : (
        <span className="bench-cover-placeholder">{book.title.slice(0, 2)}</span>
      )}
```

with:

```tsx
      {book.coverUrl ? (
        <Image
          src={book.coverUrl}
          alt={book.title}
          width={56}
          height={84}
          unoptimized
        />
      ) : (
        <span className="bench-cover-placeholder">{book.title.slice(0, 2)}</span>
      )}
```

- [ ] **Step 2: Confirm the chip already falls back to ISBN**

The `BookNoteChip` renders `{book.title}`. For unwarmed books, `resolveShelf` (Task 4) sets `title = isbn13`, so the chip already shows the ISBN. No change needed — verify by reading the `BookNoteChip` body (lines 180–182) and confirm it uses `book.title`.

- [ ] **Step 3: Build + run the full test suite**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 4: Commit**

```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
git add my-app/components/BenchOverlay.tsx
git commit -m "feat(overlay): render mirrored coverUrl; ISBN-label fallback for unwarmed"
```

---

### Task 9: Migration — apply schema to prod, warm existing books, drop shelf-cache read

**Files:**
- None modified (runtime/migration step). Verifies `lib/data/shelf-cache.json` is no longer referenced.

**Interfaces:**
- Consumes: `scripts/warm-books.ts` (Task 6); the prod Supabase project `kuyytbmmvxcmiyxqsnpe`.

- [ ] **Step 1: Apply the schema to the production Supabase project**

Run the new `public.books` + `covers` blocks from `my-app/lib/db/schema.sql` against the production Supabase project `kuyytbmmvxcmiyxqsnpe` / `pingusama-tinkering` (via the Supabase SQL editor or `psql`). The blocks are idempotent. Expected: `public.books` table + `covers` bucket exist.

- [ ] **Step 2: Verify the `covers` bucket is public**

In the Supabase dashboard → Storage, confirm a `covers` bucket exists and is public. Upload a small test file and confirm its public URL loads in a browser, then delete the test file.

- [ ] **Step 3: Warm the 5 existing shelf books**

Run (with `.env.local` populated with `GOOGLE_BOOKS_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`):

```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app"
npm run warm-books
```

Expected output: five `WARM 978… -> warmed` lines (or `no-cover` for any without a cover). Verify in the Supabase dashboard that `public.books` has 5 rows with `cover_url` populated and the `covers` bucket has 5 images.

- [ ] **Step 4: Confirm `shelf-cache.json` is no longer referenced**

Run: `cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app" && grep -rn "shelf-cache" lib app components 2>&1 || echo "no references — good"`
Expected: `no references — good`. The file may remain on disk as a legacy artifact.

- [ ] **Step 5: Commit any cleanup**

If `shelf-cache.json` should be removed from the repo, delete it and commit:

```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
git rm my-app/lib/data/shelf-cache.json
git commit -m "chore: remove unused shelf-cache.json (covers now in Supabase)"
```

If keeping it as a legacy artifact is preferred, skip this step and note it in the HANDOFF.

---

### Task 10: Verify, deploy, write HANDOFF

**Files:**
- Modify: `HANDOFF.md` (root of the worktree, alongside `my-app/`)

- [ ] **Step 1: Run the full verification suite**

Run:
```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app"
npm run build
npm test
npm run lint
```
Expected: build passes; all tests pass; lint shows only pre-existing `no-explicit-any` errors in `scripts/apply-rls.ts`, `scripts/check-rls.ts`, `scripts/fetch-book.ts` (no new errors).

- [ ] **Step 2: Mobile check at 390 px**

With `npm run dev` running, open the homepage and `/admin/bench` at 390 px width. Confirm: cover row is single-column, chips wrap, status badges wrap, no horizontal overflow, text left-aligned. Confirm covers load from a `https://...supabase.../covers/...` URL in the network tab (not `books.google.com`).

- [ ] **Step 3: Deploy to production**

Run:
```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel/my-app"
npx vercel --prod --yes --scope thegrandpingu-9836s-projects
```

Expected: deployment completes; the production URL https://pingu-tinkering.vercel.app loads with covers served from Supabase. Open the bench overlay and confirm covers render.

- [ ] **Step 4: Push to GitHub**

Run:
```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
git push origin master
```

- [ ] **Step 5: Write a fresh HANDOFF.md**

Overwrite `D:\claude projects\Pingusama's Repositories\pingusama-site-mockup-wheel\HANDOFF.md` with a new handoff following the existing structure (Session date 2026-07-10, what changed this session, live URLs, verification done, known issues / next session focus, files of note, how to pick up locally, next-session starter prompt). Per the user's handoff rule, append a copyable next-session starter prompt at the end. Cover: Supabase `public.books` + `covers` bucket, admin-only warming, `warmBooksAction`/`previewBookAction`/`listBookStatusesAction`, cover source priority (Google `zoom=0` → Open Library), 30-day staleness, the `warm-books` CLI, removal of `shelf-cache.json` from the read path, mobile + token notes, and any open items (e.g. Open Library placeholder heuristic, optional future SWR).

- [ ] **Step 6: Commit the HANDOFF**

```bash
cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
git add HANDOFF.md
git commit -m "docs: fresh HANDOFF for book cover resolution session"
git push origin master
```