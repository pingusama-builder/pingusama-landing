import { describe, expect, it, vi, afterEach } from "vitest";
import { editionCoverFromHtml, editionCoverFromExtract, rescueEditionCover, publisherEditionPage } from "@/lib/book-cover-rescue";
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

it("validates NeoDB and iMusic edition artwork without assuming its visual format",()=>{
 const n="https://neodb.social/book/ABC";const ni="https://neodb.social/m/item/book/2026/cover.jpg";
 expect(editionCoverFromHtml(html("9789865580704",n,ni),n,"9789865580704")).toBe(ni);
 const p="https://imusic.co/books/9781738401567/2025-indie";const image="https://imusic.b-cdn.net/images/item/original/567/9781738401567.jpg";
 const record={"@type":"Product",gtin13:"9781738401567",offers:{url:p},image};
 const markup=(r:unknown)=>`<script type="application/ld+json">${JSON.stringify({"@graph":[r]})}</script>`;
 expect(editionCoverFromHtml(markup(record),p,"9781738401567")).toBe(image);
 expect(editionCoverFromHtml(markup({...record,image:image.replace("9781738401567.jpg","9789865580704.jpg")}),p,"9781738401567")).toBeNull();
});

describe("publisher-independent edition evidence",()=>{
 it("accepts an ISBN-bound main Book record from a publisher outside the old source list",()=>{
  const p="https://press.example/books/selected-edition";
  const cover="https://cdn.press.example/covers/selected.jpg";
  expect(editionCoverFromHtml(html("9789865580704",p,cover),p,"9789865580704")).toBe(cover);
 });
 it("recognizes the primary edition in a publisher graph without adopting recommended books",()=>{
  const p="https://www.panmacmillan.com/authors/emily-st-john-mandel/exit-party/9781035081288";
  const cover="https://ik.imagekit.io/panmac/tr:f-auto,w-1200/edition/9781035081288.jpg";
  const markup=`<script type="application/ld+json">${JSON.stringify({"@graph":[{"@type":"Book",isbn:"9781035081288",url:p,image:cover},{"@type":"ItemList",itemListElement:[{"@type":"Book",isbn:"9780593321461",url:"https://press.example/other",image:"https://cdn.press.example/other.jpg"}]}]})}</script>`;
  expect(editionCoverFromHtml(markup,p,"9781035081288")).toBe(cover);
  expect(editionCoverFromHtml(markup,p,"9780593321461")).toBeNull();
 });
 it("binds a primary Book without a URL to the canonical publisher page",()=>{
  const p="https://www.penguinrandomhouse.com/books/692736/exit-party-by-emily-st-john-mandel/";
  const cover="https://images.penguinrandomhouse.com/cover/9780593321461";
  const markup=`<link href="${p}" rel="canonical"><script type="application/ld+json">${JSON.stringify({"@type":"Book",isbn:"9780593321461",image:cover,hasPart:[{"@type":"Book",isbn:9780593321478}]})}</script>`;
  expect(editionCoverFromHtml(markup,p,"9780593321461")).toBe(cover);
  expect(editionCoverFromHtml(markup,p,"9780593321478")).toBeNull();
 });
 it("does not bind an unrelated root record or a private image to a generic page",()=>{
  const p="https://press.example/books/current";
  expect(editionCoverFromHtml(html("9789865580704",p+"-other","https://cdn.press.example/cover.jpg"),p,"9789865580704")).toBeNull();
  expect(editionCoverFromHtml(html("9789865580704",p,"https://127.0.0.1/cover.jpg"),p,"9789865580704")).toBeNull();
 });
});

describe("edition verification on extracted source pages",()=>{
 const book={title:"Exit Party",authors:["Emily St. John Mandel"],publisher:"Knopf"};
 const page="https://bookseller.example/books/exit-party";
 const image="https://images.penguinrandomhouse.com/cover/9780593321461";
 const content=`# Exit Party\nEmily St. John Mandel\nISBN: 9780593321461\n![Exit Party cover](${image})`;
 it("accepts only a primary title/author/ISBN with an edition-bound image",()=>{
  expect(editionCoverFromExtract(content,[image],page,"9780593321461",book)).toBe(image);
 });
 it("rejects alternate editions, unrelated authors and multiple labelled ISBNs",()=>{
  expect(editionCoverFromExtract(content,[image],page,"9780593321478",book)).toBeNull();
  expect(editionCoverFromExtract(content.replace("Emily St. John Mandel","Other Author"),[image],page,"9780593321461",book)).toBeNull();
  expect(editionCoverFromExtract(content+"\nISBN: 9780593321478",[image],page,"9780593321461",book)).toBeNull();
 });
 it("does not adopt logos, unknown CDN images or private destinations",()=>{
  expect(editionCoverFromExtract(content.replace(image,"https://images.penguinrandomhouse.com/logo.jpg"),[],page,"9780593321461",book)).toBeNull();
  expect(editionCoverFromExtract(content.replace(image,"https://cdn.unknown.example/9780593321461.jpg"),[],page,"9780593321461",book)).toBeNull();
  expect(editionCoverFromExtract(content,[image],"https://127.0.0.1/private","9780593321461",book)).toBeNull();
 });
});
