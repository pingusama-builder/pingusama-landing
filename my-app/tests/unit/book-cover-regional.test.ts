import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("@/lib/covers",async original=>({...await original<typeof import("@/lib/covers")>(),fetchVerifiedCoverImage:vi.fn().mockResolvedValue({bytes:Buffer.from("image"),mimeType:"image/jpeg",width:300,height:480})}));
import {classifyCoverSource,editionCoverFromHtml,findEditionCover} from "@/lib/book-cover-rescue";
import {collectBenchTrace} from "@/lib/bench-trace";
import {fetchVerifiedCoverImage} from "@/lib/covers";
const isbn="9780241968628";
const uk="https://www.penguin.co.uk/books/482991/chronicle-of-a-death-foretold-by-marquez-gabriel-garcia/"+isbn;
const image="https://cdn.penguin.co.uk/dam-assets/books/"+isbn+"/"+isbn+"-jacket-large.jpg";
const book={title:"Chronicle of a Death Foretold",authors:["Gabriel García Márquez"],publisher:"Penguin"};
const html='<link rel="canonical" href="'+uk+'"><script type="application/ld+json">'+JSON.stringify({"@type":"WebPage",primaryImageOfPage:{"@type":"ImageObject",url:image}})+"</script>";
const page=(body:string)=>new Response(body,{headers:{"content-type":"text/html"}});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});
describe("regional cover discovery",()=>{
 it("recognizes publisher and retailer identities by verified host and product path",()=>{
  expect(classifyCoverSource(uk)).toMatchObject({kind:"publisher",market:"uk",provider:"www.penguin.co.uk"});
  expect(classifyCoverSource("https://www.waterstones.com/book/"+isbn)).toMatchObject({kind:"retailer",market:"uk"});
  expect(classifyCoverSource("https://www.penguin.co.uk.attacker.example/books/a/"+isbn)).toBeNull();
  expect(classifyCoverSource("https://www.penguin.co.uk/articles/"+isbn)).toBeNull();
 });
 it("binds the publisher WebPage primary image to the same edition and canonical page",()=>{
  expect(editionCoverFromHtml(html,uk,isbn)).toBe(image);
  expect(editionCoverFromHtml(html,uk,"9780241969809")).toBeNull();
  expect(editionCoverFromHtml(html.replace(image,image.replaceAll(isbn,"9780241969809")),uk,isbn)).toBeNull();
  expect(editionCoverFromHtml(html.replace('href="'+uk+'"','href="https://www.penguin.co.uk/books/other/9780241969809"'),uk,isbn)).toBeNull();
 });
 it("finds and ranks the UK publisher itself even when it is the fifth result after US and discussion pages",async()=>{
  vi.stubEnv("TAVILY_API_KEY","test-only");
  const queries:Record<string,unknown>[]=[];
  vi.stubGlobal("fetch",vi.fn().mockImplementation(async(url,init)=>{
   if(url==="https://api.tavily.com/search"){const query=JSON.parse(init.body);queries.push(query);return Response.json({results:[{url:"https://www.amazon.com/book/"+isbn},{url:"https://www.goodreads.com/topic/discussion"},{url:"https://www.midlandbookshop.com/book"},{url:"https://www.penguinrandomhouse.com/books/57980/chronicle/"},{url:uk}]});}
   if(url===uk)return page(html);
   throw new Error("Incorrect candidate prioritized");
  }));
  const result=await collectBenchTrace(async()=>{const r=await findEditionCover(null,isbn,book);return {success:!!r.image,...r};});
  expect(result.image?.sourcePage).toBe(uk);expect(fetch).toHaveBeenCalledTimes(2);
  expect(queries[0].query).toContain(isbn);expect(queries[0].query).toMatch(/UK/);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({operation:"cover.candidate",status:"selected",data:expect.objectContaining({market:"uk",kind:"publisher",sourcePage:uk})}));
 });
 it("reserves US discovery when the UK branch fails and keeps the ISBN in every title query",async()=>{
  vi.stubEnv("TAVILY_API_KEY","test-only");const queries:Record<string,unknown>[]=[];
  vi.stubGlobal("fetch",vi.fn().mockImplementation(async(url,init)=>{
   if(url==="https://api.tavily.com/search"){queries.push(JSON.parse(init.body));return Response.json({results:[]});}return page("");
  }));
  expect(await findEditionCover(null,isbn,book)).toMatchObject({image:null});
  expect(queries.some(q=>String(q.query).includes("UK"))).toBe(true);
  expect(queries.some(q=>String(q.query).includes("US"))).toBe(true);
  expect(queries.every(q=>String(q.query).includes(isbn))).toBe(true);
  expect(queries.filter(q=>String(q.query).includes(book.title))).toHaveLength(2);
 });
 it("does not replace the selected ISBN with a different UK or US edition",async()=>{
  vi.stubEnv("TAVILY_API_KEY","test-only");const wrong=uk.replace(isbn,"9780241969809");
  vi.stubGlobal("fetch",vi.fn().mockImplementation(async(url)=>url==="https://api.tavily.com/search"?Response.json({results:[{url:wrong},{url:"https://www.amazon.com/book/9780394530741"}]}):page(html)));
  expect(await findEditionCover(null,isbn,book)).toMatchObject({image:null});
  expect(fetchVerifiedCoverImage).not.toHaveBeenCalled();
  expect(vi.mocked(fetch).mock.calls.map(call=>call[0])).not.toContain(wrong);
 });
});

it("preserves discovery of an existing supported publisher when saved publisher metadata is absent",async()=>{
 vi.stubEnv("TAVILY_API_KEY","test-only");const isbn="9781738401567",source="https://www.bitmapbooks.com/products/indie";
 vi.stubGlobal("fetch",vi.fn().mockImplementation(async(url,init)=>url==="https://api.tavily.com/search"?Response.json({results:JSON.parse(init.body).include_domains?.includes("bitmapbooks.com")?[{url:source}]:[]}):page('<script type="application/ld+json">'+JSON.stringify({"@type":"Product",mpn:isbn,image:"https://www.bitmapbooks.com/cdn/shop/files/indie.jpg",offers:{url:source}})+"</script>")));
 expect(await findEditionCover(null,isbn,{title:"50 Indie Games That Changed the World",authors:["Bitmap Books"],publisher:null})).toMatchObject({image:{sourcePage:source}});
});
