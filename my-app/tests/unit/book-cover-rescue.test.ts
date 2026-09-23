import { describe, expect, it, vi, afterEach } from "vitest";
import { editionCoverFromHtml, rescueEditionCover, publisherEditionPage } from "@/lib/book-cover-rescue";
const page="https://www.sanmin.com.tw/product/index/009463837";
const image="https://cdnec.sanmin.com.tw/product_images/986/986558070.jpg";
function html(isbn="9789865580704",url=page,cover=image){return `<script type="application/ld+json">${JSON.stringify({"@type":"Book",isbn,url,image:cover})}</script>`;}
afterEach(()=>vi.unstubAllGlobals());
describe("edition-bound supported retailer cover",()=>{
 it("extracts only the image tied to the matching edition",()=>expect(editionCoverFromHtml(html(),page,"9789865580704")).toBe(image));
 it("rejects another edition and related-product record",()=>{
  expect(editionCoverFromHtml(html("9780307473394"),page,"9789865580704")).toBeNull();
  expect(editionCoverFromHtml(html("9789865580704",page+"1"),page,"9789865580704")).toBeNull();
 });
 it("rejects ambiguous records and untrusted image destinations",()=>{
  expect(editionCoverFromHtml(html()+html(),page,"9789865580704")).toBeNull();
  expect(editionCoverFromHtml(html("9789865580704",page,"https://127.0.0.1/private"),page,"9789865580704")).toBeNull();
 });
 it("does not request unsupported or credentialed page URLs",async()=>{
  vi.stubGlobal("fetch",vi.fn());expect(await rescueEditionCover("https://user:pass@www.sanmin.com.tw/product/index/009463837","9789865580704")).toBeNull();expect(fetch).not.toHaveBeenCalled();
 });
 it("does not promote a 403 page to a cover result",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("blocked",{status:403})));expect(await rescueEditionCover(page,"9789865580704")).toBeNull();
 });
});

describe("publisher cover verification",()=>{
 const page="https://www.bitmapbooks.com/products/50-indie-games-that-changed-the-world";
 const image="https://www.bitmapbooks.com/cdn/shop/files/indie.jpg?v=1";
 const product=(mpn="9781738401567",url=page)=>`<script type="application/ld+json">${JSON.stringify({"@type":"Product",mpn,image,offers:{url}})}</script>`;
 it("binds a Bitmap publisher product photo to its ISBN and offer page",()=>{
  expect(editionCoverFromHtml(product(),page,"9781738401567")).toBe(image);
  expect(editionCoverFromHtml(product("9789865580704"),page,"9781738401567")).toBeNull();
  expect(editionCoverFromHtml(product("9781738401567",page+"-other"),page,"9781738401567")).toBeNull();
 });
 it("discovers an exact edition from its own bibliography card, not an adjacent title",()=>{
  const card=(id:string,path:string)=>`<div class="bibliography__item"><a href="/products/${path}">Book</a><div>ISBN: ${id}</div></div>`;
  expect(publisherEditionPage(card("9789865580704","wrong")+card("9781738401567","indie"),"9781738401567")).toBe("https://www.bitmapbooks.com/products/indie");
  expect(publisherEditionPage(card("9789865580704","wrong"),"9781738401567")).toBeNull();
  expect(publisherEditionPage(card("9781738401567","one")+card("9781738401567","two"),"9781738401567")).toBeNull();
 });
});
