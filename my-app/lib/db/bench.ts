import { createServiceClient } from "@/lib/supabase/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ShelfData, VaultData } from "@/lib/books";

const SHELF_PATH = join(process.cwd(), "lib", "data", "shelf.json");
const VAULT_PATH = join(process.cwd(), "lib", "data", "vault.json");

export async function loadShelf(): Promise<ShelfData> {
  return loadFromSupabase<ShelfData>("shelf", SHELF_PATH);
}

export async function loadVault(): Promise<VaultData> {
  return loadFromSupabase<VaultData>("vault", VAULT_PATH);
}

export async function saveShelf(shelf: ShelfData): Promise<void> {
  await saveToSupabase("shelf", shelf);
}

export async function saveVault(vault: VaultData): Promise<void> {
  await saveToSupabase("vault", vault);
}

async function loadFromSupabase<T>(key: string, fallbackPath: string): Promise<T> {
  try {
    const client = createServiceClient();
    const { data, error } = await client
      .from("bench")
      .select("data")
      .eq("key", key)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? `No bench row for ${key}`);
    }
    return data.data as T;
  } catch (err) {
    console.warn(
      `Supabase bench load failed for ${key}, falling back to JSON:`,
      err instanceof Error ? err.message : err
    );
    const raw = readFileSync(fallbackPath, "utf8");
    return JSON.parse(raw) as T;
  }
}

async function saveToSupabase(key: string, data: unknown): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.from("bench").upsert(
    {
      key,
      data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
  if (error) {
    throw new Error(`Failed to save ${key} to Supabase: ${error.message}`);
  }
}
