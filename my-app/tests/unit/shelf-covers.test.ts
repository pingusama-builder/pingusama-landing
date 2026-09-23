import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareShelfCovers } from "@/lib/shelf-covers";
import { fetchCoverBytes } from "@/lib/covers";
import { fetchBookByIsbn, fetchBookByOpenLibrary, type Book, type ShelfData } from "@/lib/books";
import { mirrorCover } from "@/lib/db/books";
vi.mock("@/lib/book-cover-rescue",()=>({findEditionCover:vi.fn().mockResolvedValue(null)}));
vi.mock("@/lib/covers",()=>({fetchCoverBytes:vi.fn()}));
vi.mock("@/lib/books",()=>({fetchBookByIsbn:vi.fn(),fetchBookByOpenLibrary:vi.fn()}));
vi.mock("@/lib/db/books",()=>({mirrorCover:vi.fn()}));
const book:Book={googleBooksId:"google-one",title:"Selected edition",authors:["Author"],isbn13:"9780307473394",isbn10:null,subtitle:null,publisher:"Selected publisher",publishedDate:"2011",pageCount:320,infoLink:null,thumbnail:"https://books.google.com/unverified",coverUrl:"https://books.google.com/unverified",coverSource:"google"};
const makeShelf=():ShelfData=>({currentlyReading:[{isbn13:book.isbn13!,requestedIsbn:"9789865580704",note:"My note",selection:{book:{...book},source:"google",language:"en",match:"same-work"}}],tbr:[]});
const image={bytes:Buffer.from("validated-image"),mimeType:"image/jpeg",source:"google" as const,sourceUrl:"https://books.google.com/books/content?id=google-one",width:400,height:600};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(fetchBookByIsbn).mockResolvedValue(book);vi.mocked(fetchBookByOpenLibrary).mockResolvedValue(null);vi.mocked(fetchCoverBytes).mockResolvedValue(image);vi.mocked(mirrorCover).mockResolvedValue("https://storage.example/covers/edition-hash.jpg");});
describe("selected edition cover persistence",()=>{
 it("preserves selected and requested ISBNs while saving a validated asset",async()=>{
  const result=await prepareShelfCovers(makeShelf(),{currentlyReading:[],tbr:[]});const entry=result.currentlyReading[0];
  expect(entry.isbn13).toBe(book.isbn13);expect(entry.requestedIsbn).toBe("9789865580704");expect(entry.note).toBe("My note");
  expect(entry.selection?.book.publisher).toBe("Selected publisher");expect(entry.selection?.book.coverAsset).toMatchObject({status:"available",source:"google",width:400,height:600,format:"unreviewed"});
  expect(entry.selection?.book.thumbnail).toBeNull();expect(entry.selection?.book.coverUrl).toBe("https://storage.example/covers/edition-hash.jpg");
  expect(vi.mocked(mirrorCover).mock.calls[0][0]).toMatch(/^edition-[a-f0-9]{24}-[a-f0-9]{64}$/);
 });
 it("reuses only the previously persisted asset for the same edition",async()=>{
  const saved=await prepareShelfCovers(makeShelf(),{currentlyReading:[],tbr:[]});vi.clearAllMocks();const input=makeShelf();input.currentlyReading[0].selection!.book.coverUrl="https://attacker.example/image";
  const result=await prepareShelfCovers(input,saved);expect(result.currentlyReading[0].selection?.book.coverUrl).toBe(saved.currentlyReading[0].selection?.book.coverUrl);expect(fetchCoverBytes).not.toHaveBeenCalled();expect(mirrorCover).not.toHaveBeenCalled();
 });
 it("does not reuse a different selected ISBN's cover",async()=>{
  const saved=await prepareShelfCovers(makeShelf(),{currentlyReading:[],tbr:[]});vi.clearAllMocks();const input=makeShelf();input.currentlyReading[0].isbn13="9789865580704";input.currentlyReading[0].selection!.book.isbn13="9789865580704";
  await prepareShelfCovers(input,saved);expect(fetchCoverBytes).toHaveBeenCalled();
 });
 it("preserves metadata with a missing cover and permits retry",async()=>{
  vi.mocked(fetchCoverBytes).mockResolvedValue(null);const saved=await prepareShelfCovers(makeShelf(),{currentlyReading:[],tbr:[]});expect(saved.currentlyReading[0].selection?.book).toMatchObject({title:book.title,coverUrl:null,thumbnail:null,coverAsset:{status:"missing"}});
  vi.mocked(fetchCoverBytes).mockResolvedValue(image);const retried=await prepareShelfCovers(makeShelf(),saved);expect(retried.currentlyReading[0].selection?.book.coverAsset?.status).toBe("available");
 });
 it("records storage failure separately without dropping the book",async()=>{
  vi.mocked(mirrorCover).mockRejectedValue(new Error("storage offline"));const saved=await prepareShelfCovers(makeShelf(),{currentlyReading:[],tbr:[]});expect(saved.currentlyReading[0].selection?.book).toMatchObject({title:book.title,coverUrl:null,coverAsset:{status:"failed"}});
 });
 it("keeps a stable identity for a manual entry without inventing an ISBN",async()=>{
  const input=makeShelf();input.currentlyReading[0].isbn13="";const s=input.currentlyReading[0].selection!;s.source="manual";s.book.isbn13=null;s.book.googleBooksId="manual:stable";
  const saved=await prepareShelfCovers(input,{currentlyReading:[],tbr:[]});expect(saved.currentlyReading[0].selection?.book.coverAsset).toMatchObject({editionKey:"manual:manual:stable",status:"missing"});expect(fetchCoverBytes).not.toHaveBeenCalled();
 });
 it("does not replace a manually supplied cover during re-warm",async()=>{
  const saved=await prepareShelfCovers(makeShelf(),{currentlyReading:[],tbr:[]});saved.currentlyReading[0].selection!.book.coverAsset!.source="manual";vi.clearAllMocks();
  const result=await prepareShelfCovers(makeShelf(),saved,true);expect(result.currentlyReading[0].selection?.book.coverAsset?.source).toBe("manual");expect(fetchCoverBytes).not.toHaveBeenCalled();
 });
 it("keeps the previous good image when a forced refresh fails",async()=>{
  const saved=await prepareShelfCovers(makeShelf(),{currentlyReading:[],tbr:[]});vi.mocked(fetchCoverBytes).mockResolvedValue(null);
  const result=await prepareShelfCovers(makeShelf(),saved,true);expect(result.currentlyReading[0].selection?.book.coverAsset).toMatchObject({status:"available",refreshStatus:"missing",url:saved.currentlyReading[0].selection?.book.coverUrl});
 });
});

it("keeps a good cover when a forced batch defers it",async()=>{
 const saved=await prepareShelfCovers(makeShelf(),{currentlyReading:[],tbr:[]});
 const original=saved.currentlyReading[0];
 const entries=["9789865580704","9781455586691","9787020114115"].map(isbn=>({...original,isbn13:isbn,selection:{...original.selection!,book:{...original.selection!.book,isbn13:isbn,coverAsset:undefined}}}));
 const previous={currentlyReading:[...entries,original],tbr:[]};
 const result=await prepareShelfCovers(previous,previous,true);
 expect(result.currentlyReading[3].selection?.book.coverAsset).toEqual(original.selection?.book.coverAsset);
});
