import { beforeEach, expect, it, vi } from "vitest";
import type { ShelfData } from "@/lib/books";

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));
import { createServiceClient } from "@/lib/supabase/server";
import { readShelfSnapshot, saveShelfIfUnchanged } from "@/lib/db/bench";

const initial: ShelfData = { currentlyReading: [], tbr: [{ isbn13: "9780307473394", note: "Saved note" }] };
let row: { data: ShelfData; updated_at: string | null };
let unavailable: boolean;

beforeEach(() => {
  row = { data: structuredClone(initial), updated_at: "2026-10-28T00:00:00.000Z" };
  unavailable = false;
  const client = {
    from: () => {
      let update: typeof row | null = null;
      let version: string | null | undefined;
      const query = {
        select: () => query,
        update: (value: typeof row) => { update = value; return query; },
        eq: (key: string, value: string) => { if (key === "updated_at") version = value; return query; },
        is: (key: string, value: null) => { if (key === "updated_at") version = value; return query; },
        single: async () => unavailable ? { data: null, error: { message: "offline" } } : { data: structuredClone(row), error: null },
        maybeSingle: async () => {
          if (unavailable) return { data: null, error: { message: "offline" } };
          if (row.updated_at !== version || !update) return { data: null, error: null };
          row = structuredClone(update);
          return { data: { key: "shelf" }, error: null };
        },
      };
      return query;
    },
  };
  vi.mocked(createServiceClient).mockReturnValue(client as unknown as ReturnType<typeof createServiceClient>);
});

it("reads the authoritative shelf and conditionally saves the moved entry", async () => {
  const snapshot = await readShelfSnapshot();
  expect(snapshot).toEqual({ shelf: initial, updatedAt: "2026-10-28T00:00:00.000Z" });
  const moved = { currentlyReading: [initial.tbr[0]], tbr: [] };
  expect(await saveShelfIfUnchanged(moved, snapshot.updatedAt)).toBe(true);
  expect(row.data).toEqual(moved);
});

it("does not overwrite another shelf change between read and save", async () => {
  const snapshot = await readShelfSnapshot();
  row = { data: { currentlyReading: [], tbr: [{ isbn13: "9780593321461", note: "Newer" }] }, updated_at: "2026-10-28T00:00:01.000Z" };
  expect(await saveShelfIfUnchanged({ currentlyReading: snapshot.shelf.tbr, tbr: [] }, snapshot.updatedAt)).toBe(false);
  expect(row.data.tbr[0].note).toBe("Newer");
});

it("handles a shelf row whose update timestamp is null", async () => {
  row.updated_at = null;
  const snapshot = await readShelfSnapshot();
  expect(await saveShelfIfUnchanged({ currentlyReading: snapshot.shelf.tbr, tbr: [] }, snapshot.updatedAt)).toBe(true);
});

it("fails closed when the database cannot be read", async () => {
  unavailable = true;
  await expect(readShelfSnapshot()).rejects.toThrow();
});

it("advances the version even if the previous save was in the same millisecond", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T00:00:00.000Z"));
  try {
    const snapshot = await readShelfSnapshot();
    expect(await saveShelfIfUnchanged({ currentlyReading: snapshot.shelf.tbr, tbr: [] }, snapshot.updatedAt)).toBe(true);
    expect(row.updated_at).toBe("2026-10-28T00:00:00.001Z");
  } finally {
    vi.useRealTimers();
  }
});
