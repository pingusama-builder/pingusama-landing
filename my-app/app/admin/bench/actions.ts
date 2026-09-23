"use server";
import { collectBenchTrace } from "@/lib/bench-trace";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  ShelfData,
  VaultData,
  warmBook,
  Book,
  WarmResult,
} from "@/lib/books";
import { isValidIsbn13, normalizeIsbn13 } from "@/lib/isbn";
import { searchBooks, type BookSearchInput, type BookSearchResult } from "@/lib/book-search";
import { validateShelf } from "@/lib/book-selection";
import { prepareShelfCovers } from "@/lib/shelf-covers";
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

async function saveShelfActionInternal(
  shelf: ShelfData
): Promise<{ success: true; shelf?: ShelfData } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const validated = validateShelf(shelf);
    const hasSelections = [...validated.currentlyReading, ...validated.tbr].some(e => e.selection);
    const prepared = hasSelections ? await prepareShelfCovers(validated, await loadShelf()) : validated;
    await saveShelf(prepared);
    revalidatePath("/");
    revalidatePath("/admin/bench");
    return hasSelections ? { success: true, shelf: prepared } : { success: true };
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
    if (entry.selection) continue;
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

async function warmBooksActionInternal(
  opts: { force?: boolean } = {}
): Promise<
  | { success: true; results: WarmResult[]; statuses: BookStatus[]; shelf?: ShelfData }
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

    const hasSelections = [...shelf.currentlyReading, ...shelf.tbr].some(e => e.selection);
    const prepared = hasSelections ? await prepareShelfCovers(shelf, shelf, opts.force) : shelf;
    if (hasSelections) await saveShelf(prepared);
    const statuses = await listBookStatusesAction(isbns);
    revalidatePath("/");
    revalidatePath("/admin/bench");
    return { success: true, results, statuses, ...(hasSelections ? { shelf: prepared } : {}) };
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
    const result = await searchBooks({ isbn: isbn13 });
    const exact = result.candidates.find(c => c.match === "exact");
    if (!exact) return { success: false, error: result.warnings.join(" ") || "No book found. 可用書名及作者搜尋其他版本。" };
    return { success: true, book: exact.book };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to preview book";
    return { success: false, error: message };
  }
}

async function searchBooksActionInternal(input: BookSearchInput): Promise<{success:true;result:BookSearchResult}|{success:false;error:string}> {
  try {
    await requireAdmin();
    return {success:true,result:await searchBooks(input)};
  } catch (e) { return {success:false,error:e instanceof Error ? e.message : "搜尋失敗，請稍後重試。"}; }
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

export async function saveShelfAction(shelf: ShelfData){return collectBenchTrace(()=>saveShelfActionInternal(shelf));}

export async function warmBooksAction(opts: {force?:boolean} = {}){return collectBenchTrace(()=>warmBooksActionInternal(opts));}

export async function searchBooksAction(input: BookSearchInput){return collectBenchTrace(()=>searchBooksActionInternal(input));}
