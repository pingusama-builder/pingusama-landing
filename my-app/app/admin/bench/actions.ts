"use server";

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
import { loadShelf, loadVault, saveShelf, saveVault } from "@/lib/db/bench";
import {
  getBooksByIsbns,
  bookRowToBook,
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
    // After warming, read the row back and build the Book from it — no second Google fetch.
    const normalized = normalizeIsbn13(isbn13);
    const rows = await getBooksByIsbns([normalized]);
    const row = rows.get(normalized);
    if (!row) {
      return { success: false, error: "No book found. Check the ISBN-13 and API key." };
    }
    return { success: true, book: bookRowToBook(row) };
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