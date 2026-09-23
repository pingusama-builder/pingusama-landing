import { describe, expect, it, vi, afterEach } from "vitest";
import { editionCoverFromHtml, rescueEditionCover } from "@/lib/book-cover-rescue";
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
