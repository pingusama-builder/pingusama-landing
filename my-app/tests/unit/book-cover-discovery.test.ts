import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("@/lib/covers",()=>({fetchVerifiedCoverImage:vi.fn().mockResolvedValue({bytes:Buffer.from("image"),mimeType:"image/jpeg",width:400,height:300})}));
import {findEditionCover} from "@/lib/book-cover-rescue";
import {fetchVerifiedCoverImage} from "@/lib/covers";
const isbn="9781738401567";
const publisher="https://www.bitmapbooks.com/products/indie";
const page=(body:string)=>new Response(body,{headers:{"content-type":"text/html"}});
const card=`<div class="bibliography__item"><a href="/products/indie">Book</a>ISBN: ${isbn}</div>`;
const product=`<script type="application/ld+json">${JSON.stringify({"@type":"Product",mpn:isbn,image:"https://www.bitmapbooks.com/cdn/shop/files/indie.jpg",offers:{url:publisher}})}</script>`;
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});
describe("automatic edition cover discovery",()=>{
 it("finds the publisher from ISBN without an API key or a supplied product URL",async()=>{
  vi.stubEnv("TAVILY_API_KEY","");const fetch=vi.fn().mockResolvedValueOnce(page(card)).mockResolvedValueOnce(page(product));vi.stubGlobal("fetch",fetch);
  expect(await findEditionCover("https://books.google.com/books?id=missing",isbn)).toMatchObject({sourcePage:publisher,width:400});
  expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1][0]).toBe(publisher);
 });
 it("rejects wrong-edition images even when search returns the page",async()=>{
  vi.stubEnv("TAVILY_API_KEY","test-only");const fetch=vi.fn().mockResolvedValueOnce(page("")).mockResolvedValueOnce(Response.json({results:[{url:publisher}]})).mockResolvedValueOnce(page(product.replace(isbn,"9789865580704")));vi.stubGlobal("fetch",fetch);
  expect(await findEditionCover(null,isbn)).toBeNull();expect(fetchVerifiedCoverImage).not.toHaveBeenCalled();
 });
 it("limits discovery to one web query and two distinct supported pages",async()=>{
  vi.stubEnv("TAVILY_API_KEY","test-only");
  const fetch=vi.fn().mockResolvedValueOnce(page("")).mockResolvedValueOnce(Response.json({results:[{url:"https://127.0.0.1/private"},{url:publisher},{url:publisher},{url:publisher+"-two"},{url:publisher+"-three"}]})).mockImplementation(async()=>page(""));vi.stubGlobal("fetch",fetch);
  expect(await findEditionCover(null,isbn)).toBeNull();expect(fetch).toHaveBeenCalledTimes(4);
  expect(fetch.mock.calls.map(c=>c[0])).not.toContain("https://127.0.0.1/private");expect(fetchVerifiedCoverImage).not.toHaveBeenCalled();
 });
 it("does no network work for an invalid ISBN",async()=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);expect(await findEditionCover(publisher,"bad")).toBeNull();expect(fetch).not.toHaveBeenCalled();
 });
});
