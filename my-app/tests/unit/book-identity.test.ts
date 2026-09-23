import { it, expect, vi, afterEach } from "vitest";
import { fetchBookByIsbn, fetchBookByOpenLibrary } from "@/lib/books";
vi.mock("@/lib/db/books", () => ({}));
vi.mock("@/lib/covers", () => ({}));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("lets legacy warming fall back after a network failure, while strict searches report it", async () => {
  vi.stubEnv("GOOGLE_BOOKS_API_KEY", "test");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  expect(await fetchBookByIsbn("9789865580704")).toBeNull();
  await expect(fetchBookByIsbn("9789865580704",true)).rejects.toThrow("Google Books");
});
it("does not label the first Google result as the requested edition", async () => {
  vi.stubEnv("GOOGLE_BOOKS_API_KEY", "test");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({items:[{id:"wrong",volumeInfo:{title:"wrong",industryIdentifiers:[{type:"ISBN_13",identifier:"9780307473394"}]}},{id:"right",volumeInfo:{title:"right",industryIdentifiers:[{type:"ISBN_13",identifier:"9789865580704"}]}}]}))));
  expect((await fetchBookByIsbn("9789865580704"))?.title).toBe("right");
});
it("rejects an Open Library response whose identifiers contradict the query", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({"ISBN:9789865580704":{title:"wrong",identifiers:{isbn_13:["9780307473394"]}}}))));
  expect(await fetchBookByOpenLibrary("9789865580704")).toBeNull();
});
