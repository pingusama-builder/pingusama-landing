import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Book, ShelfEntry } from "@/lib/books";
import type { BookAddEvent } from "@/lib/book-add-types";
vi.mock("@/lib/books", () => ({ fetchBookByIsbn: vi.fn(), fetchBookByOpenLibrary: vi.fn() }));
vi.mock("@/lib/db/bench", () => ({ loadShelf: vi.fn(), saveShelf: vi.fn() }));
vi.mock("@/lib/shelf-covers", async original => ({...await original<typeof import("@/lib/shelf-covers")>(),prepareShelfCovers:vi.fn()}));
import { fetchBookByIsbn, fetchBookByOpenLibrary } from "@/lib/books";
import { loadShelf, saveShelf } from "@/lib/db/bench";
import { prepareShelfCovers } from "@/lib/shelf-covers";
import { runBookAdd } from "@/lib/book-add";

const isbn = "9780593321461";
const book: Book = { googleBooksId:"g1", title:"Exit Party", authors:["Emily St. John Mandel"], publisher:"Knopf", publishedDate:"2026", isbn13:isbn, isbn10:null, subtitle:null, pageCount:null, infoLink:null, thumbnail:null, coverUrl:null, coverSource:null };
const entry: ShelfEntry = { isbn13:isbn, note:"new note", selection:{book,source:"google",match:"exact",language:"en"} };
const covered: ShelfEntry = {...entry, selection:{...entry.selection!, book:{...book,coverUrl:"https://storage.example/cover.jpg",coverAsset:{editionKey:`isbn:${isbn}`,status:"available",format:"flat-front",checkedAt:"today",url:"https://storage.example/cover.jpg"}}}};
const empty = {currentlyReading:[], tbr:[]};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadShelf).mockImplementation(async()=>structuredClone(empty));
  vi.mocked(saveShelf).mockResolvedValue(undefined);
  vi.mocked(fetchBookByIsbn).mockResolvedValue(book);
  vi.mocked(fetchBookByOpenLibrary).mockResolvedValue(null);
  vi.mocked(prepareShelfCovers).mockResolvedValue({currentlyReading:[covered], tbr:[]});
});
describe("single book confirmation", () => {
  it("emits progress before cover work completes, then persists only this TBR book", async () => {
    const events: BookAddEvent[] = [];
    let finish!: (value: Awaited<ReturnType<typeof prepareShelfCovers>>) => void;
    vi.mocked(prepareShelfCovers).mockImplementation(() => new Promise(resolve => {finish=resolve;}));
    const pending = runBookAdd({section:"tbr", entry}, event => events.push(event));
    await vi.waitFor(() => expect(prepareShelfCovers).toHaveBeenCalledOnce());
    expect(events).toContainEqual(expect.objectContaining({type:"progress", step:"cover", status:"running"}));
    expect(saveShelf).not.toHaveBeenCalled();
    finish({currentlyReading:[covered], tbr:[]});
    expect(await pending).toMatchObject({success:true, entry:covered});
    expect(saveShelf).toHaveBeenCalledWith({currentlyReading:[], tbr:[covered]});
    expect(events.at(-1)).toMatchObject({step:"save",status:"done"});
  });
  it("rejects inconsistent selected ISBN before any provider or persistence call", async () => {
    const result = await runBookAdd({section:"tbr",entry:{...entry,isbn13:"9781035081288"}},vi.fn());
    expect(result.success).toBe(false);
    expect(fetchBookByIsbn).not.toHaveBeenCalled();
    expect(prepareShelfCovers).not.toHaveBeenCalled();expect(saveShelf).not.toHaveBeenCalled();
  });
  it("creates a selection from an exact ISBN lookup without swapping editions", async () => {
    expect(await runBookAdd({section:"currentlyReading",entry:{isbn13:isbn,note:"legacy"}},vi.fn())).toMatchObject({success:true});
    expect(prepareShelfCovers).toHaveBeenCalledWith(expect.objectContaining({currentlyReading:[expect.objectContaining({selection:expect.objectContaining({match:"exact",source:"google"})})]}),empty);
    expect(fetchBookByIsbn).toHaveBeenCalledWith(isbn,true,true);
  });
  it("requires an explicit selection when exact providers do not find the ISBN", async () => {
    vi.mocked(fetchBookByIsbn).mockResolvedValue({...book,isbn13:"9781035081288"});
    expect(await runBookAdd({section:"tbr",entry:{isbn13:isbn,note:""}},vi.fn())).toMatchObject({success:false});
    expect(prepareShelfCovers).not.toHaveBeenCalled();expect(saveShelf).not.toHaveBeenCalled();
  });
  it("keeps a selected book and reports provider discrepancies instead of replacing its identity", async () => {
    vi.mocked(fetchBookByIsbn).mockResolvedValue({...book,title:"Different title"});
    const result=await runBookAdd({section:"tbr",entry},vi.fn());
    expect(result).toMatchObject({success:true,warnings:[expect.stringContaining("書名")]});
    expect(vi.mocked(prepareShelfCovers).mock.calls[0][0].currentlyReading[0].selection?.book.title).toBe("Exit Party");
  });
  it("saves metadata with a clear warning when no cover can be confirmed", async () => {
    vi.mocked(prepareShelfCovers).mockResolvedValue({currentlyReading:[{...entry,selection:{...entry.selection!,book:{...book,coverAsset:{editionKey:`isbn:${isbn}`,status:"failed",format:"unreviewed",checkedAt:"today",failureReason:"search-unavailable"}}}}],tbr:[]});
    expect(await runBookAdd({section:"tbr",entry},vi.fn())).toMatchObject({success:true,warnings:[expect.stringContaining("搜尋服務")]});
    expect(saveShelf).toHaveBeenCalledOnce();
  });
  it("re-reads after slow work, preserving current notes, order and other entries without duplicating this edition", async () => {
    const existing={...entry,note:"edited in another tab"};
    const other={isbn13:"9780307473394",note:"keep me"};
    vi.mocked(loadShelf).mockResolvedValueOnce(empty).mockResolvedValueOnce({currentlyReading:[other],tbr:[existing]});
    expect(await runBookAdd({section:"tbr",entry},vi.fn())).toMatchObject({success:true,alreadyPresent:true});
    const saved=vi.mocked(saveShelf).mock.calls[0][0];
    expect(saved.currentlyReading).toEqual([other]);expect(saved.tbr).toHaveLength(1);
    expect(saved.tbr[0].note).toBe(existing.note);expect(saved.tbr[0].selection?.book.coverAsset?.status).toBe("available");
  });
  it("does not report success or expose database error text when saving fails", async () => {
    vi.mocked(saveShelf).mockRejectedValue(new Error("credential=secret"));const events:BookAddEvent[]=[];
    const result=await runBookAdd({section:"tbr",entry},event=>events.push(event));
    expect(result.success).toBe(false);expect(JSON.stringify({result,events})).not.toContain("secret");
    expect(events).not.toContainEqual(expect.objectContaining({step:"save",status:"done"}));
  });
});
