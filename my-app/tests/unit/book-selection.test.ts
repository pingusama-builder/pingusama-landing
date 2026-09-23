import { it, expect, vi } from "vitest";
import { validateShelf } from "@/lib/book-selection";
import { resolveShelf, type Book } from "@/lib/books";
vi.mock("@/lib/db/books",()=>({getBooksByIsbns:vi.fn().mockResolvedValue(new Map())}));
const book:Book={googleBooksId:"manual:one",title:"未收錄的書",authors:["作者"],isbn13:null,isbn10:null,subtitle:null,publisher:null,publishedDate:null,pageCount:null,infoLink:null,thumbnail:null,coverUrl:null,coverSource:null};
it("saves and resolves a manual book without inventing an ISBN or requiring a provider",async()=>{
 const shelf=validateShelf({currentlyReading:[{isbn13:"",note:"note",selection:{book,language:"unknown",source:"manual",match:"manual"}}],tbr:[]});
 const resolved=await resolveShelf(shelf);
 expect(resolved.currentlyReading[0].title).toBe(book.title);expect(resolved.currentlyReading[0].isbn13).toBeNull();expect(resolved.errors).toEqual([]);
});
it("keeps the requested identifier apart from the selected edition and rejects inconsistent keys",()=>{
 const selected={...book,isbn13:"9780307473394"};
 const shelf={currentlyReading:[{isbn13:"9780307473394",requestedIsbn:"9789865580704",note:"",selection:{book:selected,language:"en" as const,source:"google" as const,match:"same-work" as const}}],tbr:[]};
 expect(validateShelf(shelf).currentlyReading[0].requestedIsbn).toBe("9789865580704");
 shelf.currentlyReading[0].isbn13="9789865580704";expect(()=>validateShelf(shelf)).toThrow();
});
it("removes unsafe source and cover URLs before persistence",()=>{
 const b={...book,infoLink:"javascript:alert(1)",coverUrl:"data:text/html,bad"};
 const shelf=validateShelf({currentlyReading:[],tbr:[{isbn13:"",note:"",selection:{book:b,language:"unknown",source:"manual",match:"manual"}}]});
 expect(shelf.tbr[0].selection?.book.infoLink).toBeNull();expect(shelf.tbr[0].selection?.book.coverUrl).toBeNull();
});
