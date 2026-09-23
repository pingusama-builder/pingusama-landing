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
  bookRowToBook: vi.fn(),
  isStale: vi.fn(),
}));

vi.mock("@/lib/books", () => ({
  warmBook: vi.fn(),
  fetchBookByIsbn: vi.fn(),
}));

vi.mock("@/lib/book-search", () => ({ searchBooks: vi.fn() }));
vi.mock("@/lib/shelf-covers", () => ({ prepareShelfCovers: vi.fn() }));
import { prepareShelfCovers } from "@/lib/shelf-covers";
import { requireAdmin } from "@/lib/auth";
import { searchBooks } from "@/lib/book-search";

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
    expect(revalidatePath).toHaveBeenCalledWith("/admin/bench");
  });

  it("saveShelfAction returns an error when persistence fails", async () => {
    vi.mocked(bench.saveShelf).mockRejectedValue(new Error("DB unavailable"));
    const result = await saveShelfAction({ currentlyReading: [], tbr: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("DB unavailable");
  });

  it("persists the server-prepared selected cover and returns it to the editor", async () => {
    const book = {googleBooksId:"g1",title:"Selected",authors:["Author"],isbn13:"9780307473394",isbn10:null,subtitle:null,publisher:null,publishedDate:null,pageCount:null,infoLink:null,thumbnail:null,coverUrl:null,coverSource:null};
    const shelf = {currentlyReading:[{isbn13:"9780307473394",note:"note",selection:{book,source:"google" as const,match:"exact" as const,language:"en" as const}}],tbr:[]};
    const prepared = structuredClone(shelf);
    const previous = {currentlyReading:[],tbr:[]};
    vi.mocked(bench.loadShelf).mockResolvedValue(previous);
    vi.mocked(prepareShelfCovers).mockResolvedValue(prepared);
    vi.mocked(bench.saveShelf).mockResolvedValue(undefined);
    expect(await saveShelfAction(shelf)).toEqual({success:true,shelf:prepared});
    expect(prepareShelfCovers).toHaveBeenCalledWith(shelf,previous);
    expect(bench.saveShelf).toHaveBeenCalledWith(prepared);
  });

  it("does not acquire or persist covers when admin authentication fails", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"));
    expect(await saveShelfAction({currentlyReading:[],tbr:[]})).toEqual({success:false,error:"Unauthorized"});
    expect(prepareShelfCovers).not.toHaveBeenCalled();
    expect(bench.saveShelf).not.toHaveBeenCalled();
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
    expect(books.warmBook).toHaveBeenCalledTimes(1);
    expect(books.warmBook).toHaveBeenCalledWith("9780307473394", {});
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

  it("previewBookAction returns a read-only preview without warming or writing", async () => {
    const book = { googleBooksId: "g1", title: "Preview Book", authors: [], publisher: null, publishedDate: null, pageCount: null, infoLink: null, thumbnail: null, isbn13: "9780307473394", isbn10: null, subtitle: null, coverUrl: null, coverSource: null };
    vi.mocked(searchBooks).mockResolvedValue({ candidates: [{book,source:"google",language:"en",match:"exact"}],leads:[],warnings:[] });
    const result = await previewBookAction("9780307473394");
    expect(result).toEqual({success:true,book});
    expect(books.warmBook).not.toHaveBeenCalled();
    expect(bench.saveShelf).not.toHaveBeenCalled();
    expect(dbBooks.getBooksByIsbns).not.toHaveBeenCalled();
  });

  it("previewBookAction preserves provider errors instead of claiming a book is missing", async () => {
    vi.mocked(searchBooks).mockResolvedValue({candidates:[],leads:[],warnings:["Provider temporarily unavailable"]});
    expect(await previewBookAction("9780307473394")).toEqual({success:false,error:"Provider temporarily unavailable"});
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
