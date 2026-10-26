import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("@/lib/covers",async original=>({...await original<typeof import("@/lib/covers")>(),fetchVerifiedCoverImage:vi.fn().mockResolvedValue({bytes:Buffer.from("image"),mimeType:"image/jpeg",width:400,height:300})}));
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
  expect(await findEditionCover("https://books.google.com/books?id=missing",isbn)).toMatchObject({image:{sourcePage:publisher,width:400}});
  expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1][0]).toBe(publisher);
 });
 it("rejects wrong-edition images even when search returns the page",async()=>{
  vi.stubEnv("TAVILY_API_KEY","test-only");const fetch=vi.fn().mockResolvedValueOnce(Response.json({results:[{url:publisher}]})).mockResolvedValueOnce(page(product.replace(isbn,"9789865580704"))).mockResolvedValueOnce(page(""));vi.stubGlobal("fetch",fetch);
  expect(await findEditionCover(null,isbn)).toMatchObject({image:null,failureReason:"no-verified-cover"});expect(fetchVerifiedCoverImage).not.toHaveBeenCalled();
 });
 it("bounds global discovery and rejects unsafe or duplicate pages",async()=>{
  vi.stubEnv("TAVILY_API_KEY","test-only");
  const fetch=vi.fn().mockResolvedValueOnce(Response.json({results:[{url:"https://127.0.0.1/private"},{url:publisher},{url:publisher},{url:publisher+"-two"},{url:publisher+"-three"}]})).mockImplementation(async()=>page(""));vi.stubGlobal("fetch",fetch);
  expect(await findEditionCover(null,isbn)).toMatchObject({image:null});expect(fetch).toHaveBeenCalledTimes(5);
  expect(fetch.mock.calls.map(c=>c[0])).not.toContain("https://127.0.0.1/private");expect(fetchVerifiedCoverImage).not.toHaveBeenCalled();
 });
 it("does no network work for an invalid ISBN",async()=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);expect(await findEditionCover(publisher,"bad")).toEqual({image:null,failureReason:"isbn-required"});expect(fetch).not.toHaveBeenCalled();
 });
});

const us="https://www.penguinrandomhouse.com/books/692736/exit-party-by-emily-st-john-mandel/";
const book={title:"Exit Party",authors:["Emily St. John Mandel"],publisher:"Knopf"};
const cover="https://images.penguinrandomhouse.com/cover/9780593321461";
const main=`<link rel="canonical" href="${us}"><script type="application/ld+json">${JSON.stringify({"@type":"Book",isbn:"9780593321461",image:cover})}</script>`;
describe("complete cover fallback process",()=>{
 it("prioritizes a verified publisher even when it is the third search result",async()=>{
  vi.stubEnv("TAVILY_API_KEY","test-only");vi.stubGlobal("fetch",vi.fn().mockImplementation(async(url)=>{
   if(url==="https://api.tavily.com/search")return Response.json({results:[{url:"https://reference.example/book"},{url:"https://market.example/book"},{url:us}]});
   if(url==="https://api.tavily.com/extract")return Response.json({results:[]});
   return page(url===us?main:"");
  }));
  expect(await findEditionCover(null,"9780593321461",book)).toMatchObject({image:{sourcePage:us}});expect(fetch).toHaveBeenCalledWith(us,expect.anything());
 });
 it("follows a publisher canonical trailing-slash redirect",async()=>{
  const original=us.slice(0,-1);vi.stubEnv("TAVILY_API_KEY","");
  vi.stubGlobal("fetch",vi.fn().mockImplementation(async(url)=>url===original?new Response(null,{status:301,headers:{location:us}}):page(url===us?main:"")));
  expect(await findEditionCover(original,"9780593321461",book)).toMatchObject({image:{sourcePage:us}});
  expect(fetch).toHaveBeenCalledWith(us,expect.objectContaining({redirect:"manual"}));
 });
 it("rejects a source redirect leaving the verified publisher page",async()=>{
  vi.stubEnv("TAVILY_API_KEY","");vi.stubGlobal("fetch",vi.fn().mockImplementation(async(url)=>url===us?new Response(null,{status:302,headers:{location:"https://127.0.0.1/private"}}):page("")));
  expect(await findEditionCover(us,"9780593321461",book)).toMatchObject({image:null,failureReason:"source-unavailable"});
  expect(vi.mocked(fetch).mock.calls.map(call=>call[0])).not.toContain("https://127.0.0.1/private");
 });
 it("uses a verified publisher before needing a search key",async()=>{
  vi.stubEnv("TAVILY_API_KEY","");vi.stubGlobal("fetch",vi.fn().mockResolvedValue(page(main)));
  expect(await findEditionCover(us,"9780593321461",book)).toMatchObject({image:{sourcePage:us}});expect(fetch).toHaveBeenCalledOnce();
 });
 it("broadens a regional ISBN miss to title and author while retaining the ISBN",async()=>{
  vi.stubEnv("TAVILY_API_KEY","test-only");vi.stubGlobal("fetch",vi.fn().mockImplementation(async(url,init)=>{
   if(url==="https://api.tavily.com/search"){const request=JSON.parse(init.body);return Response.json({results:request.query.includes("Exit Party")&&request.query.includes("US")?[{url:us}]:[]});}
   return page(url===us?main:"");
  }));
  expect(await findEditionCover(null,"9780593321461",book)).toMatchObject({image:{sourcePage:us}});expect(fetch).toHaveBeenCalledTimes(5);
 });
 it("reads unverified source pages through the existing service instead of directly fetching them",async()=>{
  const lead="https://bookseller.example/books/exit-party";vi.stubEnv("TAVILY_API_KEY","test-only");
  vi.stubGlobal("fetch",vi.fn().mockImplementation(async(url)=>{
   if(url==="https://api.tavily.com/search")return Response.json({results:[{url:lead}]});
   if(url==="https://api.tavily.com/extract")return Response.json({results:[{url:lead,raw_content:`# Exit Party\nEmily St. John Mandel\nISBN: 9780593321461\n![Exit Party cover](${cover})`,images:[cover]}]});
   throw new Error("Unexpected direct source fetch");
  }));
  expect(await findEditionCover(null,"9780593321461",book)).toMatchObject({image:{sourcePage:lead}});expect(fetch).not.toHaveBeenCalledWith(lead,expect.anything());
 });
 it("reserves UK and US query capacity with a bounded source budget",async()=>{
  vi.stubEnv("TAVILY_API_KEY","test-only");const urls=Array.from({length:7},(_,index)=>`https://www.bitmapbooks.com/products/source-${index}`);let queries=0;
  const fetch=vi.fn().mockImplementation(async(url)=>url==="https://api.tavily.com/search"?Response.json({results:urls.slice(queries++===0?0:2).map(url=>({url}))}):page(""));vi.stubGlobal("fetch",fetch);
  expect(await findEditionCover(null,isbn,{title:"Selected book",authors:["Author"],publisher:null})).toMatchObject({image:null});
  expect(queries).toBe(4);expect(fetch.mock.calls.filter(call=>urls.includes(call[0])).length).toBeLessThanOrEqual(8);
 });
 it("reports missing search configuration, quota and blocked sources separately",async()=>{
  vi.stubEnv("TAVILY_API_KEY","");vi.stubGlobal("fetch",vi.fn().mockResolvedValue(page("")));
  expect(await findEditionCover(null,isbn)).toMatchObject({failureReason:"search-not-configured"});
  vi.stubEnv("TAVILY_API_KEY","test-only");vi.mocked(fetch).mockImplementation(async(url)=>url==="https://api.tavily.com/search"?new Response("quota",{status:429}):page(""));
  expect(await findEditionCover(null,isbn,book)).toMatchObject({failureReason:"search-unavailable"});
  vi.stubEnv("TAVILY_API_KEY","");vi.mocked(fetch).mockImplementation(async(url)=>new Response("",{status:url===us?403:200,headers:{"content-type":"text/html"}}));
  expect(await findEditionCover(us,"9780593321461",book)).toMatchObject({failureReason:"source-unavailable"});
 });
 it("re-reads pages and search results so a retry can recover a previous miss",async()=>{
  let found=false;vi.stubEnv("TAVILY_API_KEY","test-only");vi.stubGlobal("fetch",vi.fn().mockImplementation(async(url,init)=>{
   if(url==="https://api.tavily.com/search")return Response.json({results:init.cache==="no-store"?[{url:us}]:[]});
   return page(url===us&&found&&init.next?.revalidate===0?main:"");
  }));
  expect(await findEditionCover(us,"9780593321461",book)).toMatchObject({image:null});
  found=true;expect(await findEditionCover(us,"9780593321461",book)).toMatchObject({image:{sourcePage:us}});
 });
});
