"use server";

import { revalidatePath } from "next/cache";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireAdmin } from "@/lib/auth";
import {
  ShelfData,
  VaultData,
  resolveShelf,
  fetchBookByIsbn,
  Book,
} from "@/lib/books";
import { loadShelf, loadVault, saveShelf, saveVault } from "@/lib/db/bench";

const CACHE_PATH = join(process.cwd(), "lib", "data", "shelf-cache.json");

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

export async function refreshCacheAction(): Promise<
  { success: true; count: number } | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const shelf = await loadShelf();
    const resolved = await resolveShelf(shelf);
    const books = [...resolved.currentlyReading, ...resolved.tbr];
    writeFileSync(
      CACHE_PATH,
      JSON.stringify({ books }, null, 2) + "\n",
      "utf8"
    );
    revalidatePath("/");
    revalidatePath("/admin/bench");
    return { success: true, count: books.length };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to refresh cache";
    return { success: false, error: message };
  }
}

export async function previewBookAction(
  isbn13: string
): Promise<{ success: true; book: Book } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const book = await fetchBookByIsbn(isbn13);
    if (!book) {
      return {
        success: false,
        error: "No book found. Check the ISBN-13 and API key.",
      };
    }
    return { success: true, book };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to preview book";
    return { success: false, error: message };
  }
}
