import { describe, it, expect, vi } from "vitest";
import { searchBooks, sameWork, titleQueries, inferLanguage, type SearchProviders } from "@/lib/book-search";
import type { Book } from "@/lib/books";

const book = (extra: Partial<Book> = {}): Book => ({ googleBooksId: "g1", title: "動物園", authors: ["乙一"], subtitle: null, publisher: "A", publishedDate: "2021", pageCount: null, infoLink: "https://example.com/book", thumbnail: null, isbn13: "9789865580704", isbn10: null, coverUrl: null, coverSource: null, ...extra });
function providers(): SearchProviders {
  return { exact: vi.fn().mockResolvedValue([]), titles: vi.fn().mockResolvedValue([]), web: vi.fn().mockResolvedValue({ candidates: [], leads: [] }) };
}
describe("book discovery", () => {
  it("recognizes explicit foreign languages and a printed author alias",()=>{
    expect(inferLanguage("Zoo","ja")).toBe("other");
    expect(sameWork({title:"ZOO",author:"乙一"},book({title:"ZOO",authors:["乙一(Otsu Ichi)"]}))).toBe(true);
  });
  it("stops after exact ISBN and does not search other editions or the web", async () => {
    const p = providers(); vi.mocked(p.exact).mockResolvedValue([{ book: book(), language: "zh-Hant", source: "google" }]);
    const r = await searchBooks({ isbn: "9789865580704" }, p);
    expect(r.candidates[0].match).toBe("exact"); expect(p.titles).not.toHaveBeenCalled(); expect(p.web).not.toHaveBeenCalled();
  });
  it("rejects a provider's wrong ISBN and finds a same-author alternative", async () => {
    const p = providers(); vi.mocked(p.exact).mockResolvedValue([{ book: book({isbn13: "9780307473394"}), language: "zh-Hant", source: "google" }]);
    vi.mocked(p.titles).mockResolvedValue([{ book: book({isbn13: "9780307473394"}), language: "zh-Hant", source: "google" }]);
    const r = await searchBooks({isbn: "9789865580704", title: "動物園", author: "乙一", language: "zh-Hant"}, p);
    expect(r.candidates[0].match).toBe("same-work"); expect(r.candidates[0].book.isbn13).toBe("9780307473394"); expect(p.web).not.toHaveBeenCalled();
  });
  it("normalizes script without removing volume identity or accepting wrong authors", () => {
    expect(sameWork({title:"動物園", author:"乙一"}, book({title:"动物园"}))).toBe(true);
    expect(sameWork({title:"動物園 1", author:"乙一"}, book({title:"動物園 2"}))).toBe(false);
    expect(sameWork({title:"動物園", author:"另一人"}, book())).toBe(false);
    expect(titleQueries("動物園：短篇集")).toContain("動物園");
  });
  it("does not silently accept a different language, or claim timeouts are no results", async () => {
    const p = providers(); vi.mocked(p.titles).mockResolvedValue([{book:book(), language:"en", source:"google"}]);
    let r = await searchBooks({title:"動物園",author:"乙一",language:"zh-Hant"},p);
    expect(r.candidates).toHaveLength(0);
    vi.mocked(p.exact).mockRejectedValue(new Error("Provider temporarily unavailable"));
    r = await searchBooks({isbn:"9789865580704"},p);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("only recovers an unknown ISBN's title from a page that identifies that ISBN", async () => {
    const p = providers(); vi.mocked(p.web).mockResolvedValue({ candidates: [{book:book({isbn13:"9780307473394"}),language:"zh-Hant",source:"web"}], leads:[] });
    const r = await searchBooks({isbn:"9789865580704"},p);
    expect(r.candidates).toHaveLength(0);
  });
  it("caps candidates and permits other languages only on explicit retry", async () => {
    const p = providers(); vi.mocked(p.titles).mockResolvedValue([{book:book(),language:"zh-Hans",source:"google"}]);
    const r = await searchBooks({title:"動物園",author:"乙一",language:"zh-Hant",otherLanguages:true},p);
    expect(r.candidates).toHaveLength(1); expect(r.candidates[0].match).toBe("other-language");
  });
});
