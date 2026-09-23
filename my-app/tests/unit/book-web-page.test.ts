import { it, expect, vi, afterEach } from "vitest";
import { parseBookPage, bookProviders } from "@/lib/book-search-providers";
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("retains a verified page when another page fails extraction and caches the successful partial result",async()=>{
 vi.stubEnv("TAVILY_API_KEY","test");
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({results:[{title:"ZOO 乙一",url:"https://example.com/one",raw_content:"書名：ZOO\n作者：乙一\nISBN：9789865580704"},{title:"ZOO 乙一",url:"https://example.com/two",content:"ZOO 乙一"}]}))).mockRejectedValueOnce(new Error("unavailable"));
 vi.stubGlobal("fetch",fetcher);
 const result=await bookProviders.web('"ZOO" "乙一" partial-test');
 expect(result.candidates[0].book.isbn13).toBe("9789865580704");
 await bookProviders.web('"ZOO" "乙一" partial-test');expect(fetcher).toHaveBeenCalledTimes(2);
});
it("extracts a labelled book record from source page text", () => {
  const b = parseBookPage("書名：ZOO\n作者：乙一\n出版社：獨步文化\n出版日期：2021-07-01\nISBN：9789865580704", "https://www.books.com.tw/products/test");
  expect(b?.book.title).toBe("ZOO"); expect(b?.book.isbn13).toBe("9789865580704"); expect(b?.book.authors).toEqual(["乙一"]);
});
it("reads a bookstore heading and inline bibliographic fields, retaining the author's printed alias", () => {
  const page = "# ZOO\n作者：[乙一(Otsu Ichi)](https://example.com/author) 出版社：獨步文化 出版日期：2008-09-11 ISBN：9789866562037 城邦書號：1UG005X";
  const b = parseBookPage(page, "https://www.cite.com.tw/book?id=14398");
  expect(b?.book.title).toBe("ZOO"); expect(b?.book.authors).toEqual(["乙一(Otsu Ichi)"]); expect(b?.book.publisher).toBe("獨步文化"); expect(b?.book.publishedDate).toBe("2008-09-11");
});
it("does not turn recommendation prose or multiple ISBNs into a verified record", () => {
  expect(parseBookPage("推薦乙一的 ZOO，ISBN 9789865580704", "https://example.com")).toBeNull();
  expect(parseBookPage("書名：ZOO\n作者：乙一\nISBN：9789865580704\nISBN：9780307473394", "https://example.com")).toBeNull();
});
