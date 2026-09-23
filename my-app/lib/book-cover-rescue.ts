import { traceBench } from "./bench-trace";
import { canonicalIsbn } from "./isbn";
import { fetchVerifiedCoverImage, type CoverImage } from "./covers";

const sources = {
  "www.bitmapbooks.com": {path:/^\/products\/[a-z0-9-]+\/?$/,imageHost:"www.bitmapbooks.com",imagePath:/^\/cdn\/shop\/(files|products)\//},
  "www.sanmin.com.tw": {path:/^\/product\/index\/\d+\/?$/,imageHost:"cdnec.sanmin.com.tw",imagePath:/^\/product_images\//},
  "www.kingstone.com.tw": {path:/^\/basic\/\d+\/?$/,imageHost:"cdn.kingstone.com.tw",imagePath:/^\/book\/images\/product\//},
};
function supportedPage(value:string) {
  try {
    const url=new URL(value);const source=sources[url.hostname as keyof typeof sources];
    return url.protocol==="https:" && !url.username && !url.password && !url.port && source?.path.test(url.pathname) ? {url,source} : null;
  } catch { return null; }
}
export function editionCoverFromHtml(html:string,page:string,isbn:string): string | null {
  const supported=supportedPage(page);const expected=canonicalIsbn(isbn);
  if (!supported || !expected) return null;
  const records:Record<string,unknown>[]=[];
  function visit(value:unknown) {
    if (Array.isArray(value)) { value.forEach(visit);return; }
    if (!value || typeof value!=="object") return;
    const record=value as Record<string,unknown>;records.push(record);
    if (record["@graph"]) visit(record["@graph"]);
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* Invalid structured data is not evidence. */ }
  }
  const matching=records.filter(record=>{
    const types=Array.isArray(record["@type"])?record["@type"]:[record["@type"]];
    // Bitmap publishes the book ISBN as Product.mpn, not as a work-level identifier.
    const isbnValue=record.isbn ?? (supported.url.hostname==="www.bitmapbooks.com" ? record.mpn : undefined);
    if (!types.some(t=>t==="Book" || t==="Product") || typeof isbnValue!=="string" || canonicalIsbn(isbnValue)!==expected) return false;
    const offer=record.offers && !Array.isArray(record.offers) && typeof record.offers==="object" ? record.offers as Record<string,unknown> : null;
    const identity=record.url ?? record["@id"] ?? offer?.url;
    if (supported.url.hostname==="www.bitmapbooks.com" && !identity) return false;
    if (identity) { try { const url=new URL(String(identity));if(url.hostname!==supported.url.hostname || url.pathname.replace(/\/$/,"")!==supported.url.pathname.replace(/\/$/,"")) return false; } catch { return false; } }
    return true;
  });
  if (matching.length!==1) return null;
  const record=matching[0];let image=record.image;
  if (Array.isArray(image)) image=image[0];
  if (image && typeof image==="object") image=(image as Record<string,unknown>).url;
  // Some books expose a Book record without image; og:image is then tied to
  // that single ISBN-verified main record, never to arbitrary page text.
  if (typeof image!=="string") image=html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
  try {
    const url=new URL(String(image).replace(/&amp;/g,"&"));
    return url.protocol==="https:" && !url.username && !url.password && !url.port && url.hostname===supported.source.imageHost && supported.source.imagePath.test(url.pathname) ? url.toString() : null;
  } catch { return null; }
}

async function readPage(page:string):Promise<string|null> {
  const response=await fetch(page,{signal:AbortSignal.timeout(8000),redirect:"error",next:{revalidate:86400}});
  traceBench("cover.page",response.ok?"received":"failed",{provider:new URL(page).hostname,httpStatus:response.status});
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html") || !response.body || Number(response.headers.get("content-length"))>1_500_000) return null;
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_500_000){await reader.cancel();return null;}chunks.push(value);}
  return Buffer.concat(chunks).toString("utf8");
}
export async function rescueEditionCover(page:string|null,isbn:string): Promise<(CoverImage & {source:"web";sourcePage:string}) | null> {
  if (!page || !supportedPage(page)) return null;
  const html=await readPage(page);
  const url=html ? editionCoverFromHtml(html,page,isbn) : null;
  traceBench("cover.edition",url?"matched":"missing",{isbn,provider:new URL(page).hostname,code:url?"exact_isbn":"no_verified_image"});
  if (!url) return null;
  const image=await fetchVerifiedCoverImage(url);
  return image?{...image,source:"web",sourcePage:page}:null;
}
// Each bibliography card is an edition. Never associate the next card's ISBN
// with the previous product link, or use the image before product verification.
export function publisherEditionPage(html:string,isbn:string):string|null {
  const expected=canonicalIsbn(isbn);if(!expected)return null;
  const pages=new Set<string>();
  for(const card of html.split(/<div\b[^>]*class=["']bibliography__item["'][^>]*>/i).slice(1)) {
    const ids=[...card.matchAll(/ISBN:\s*([\d-]{10,17})/g)].map(m=>canonicalIsbn(m[1]));
    if(ids.length!==1 || ids[0]!==expected)continue;
    const links=[...card.matchAll(/href=["'](\/products\/[a-z0-9-]+)["']/gi)].map(m=>m[1]);
    const unique=[...new Set(links)];if(unique.length===1)pages.add("https://www.bitmapbooks.com"+unique[0]);
  }
  return pages.size===1?[...pages][0]:null;
}
export async function findEditionCover(page:string|null,isbn:string) {
  const exact=canonicalIsbn(isbn);if(!exact)return null;
  const tried=new Set<string>();
  const attempt=async(url:string|null)=>{
    if(!url || tried.has(url) || !supportedPage(url))return null;tried.add(url);
    try{return await rescueEditionCover(url,exact);}catch{traceBench("cover.page","failed",{isbn:exact,provider:new URL(url).hostname,code:"network_timeout_or_redirect"});return null;}
  };
  const known=await attempt(page);if(known)return known;
  try {
    const catalog=await readPage("https://www.bitmapbooks.com/pages/bibliography");
    const publisher=await attempt(catalog?publisherEditionPage(catalog,exact):null);if(publisher)return publisher;
  } catch {traceBench("cover.discovery","failed",{provider:"bitmap",code:"catalog_unavailable"});}
  // Optional existing free-tier web search: one query and at most two supported
  // pages. Search results are leads; the live page must still prove its ISBN.
  const key=process.env.TAVILY_API_KEY;
  if(!key){traceBench("cover.discovery","missing",{code:"web_not_configured"});return null;}
  try {
    const response=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify({query:`"${exact}"`,include_domains:Object.keys(sources),search_depth:"basic",max_results:3,include_answer:false}),signal:AbortSignal.timeout(8000),next:{revalidate:86400}});
    traceBench("cover.discovery",response.ok?"received":"failed",{provider:"tavily",httpStatus:response.status});
    if(!response.ok)return null;
    const result=await response.json() as {results?:{url?:string}[]};
    const pages=(result.results??[]).flatMap(r=>typeof r.url==="string" && supportedPage(r.url) && !tried.has(r.url)?[r.url]:[]);
    for(const candidate of [...new Set(pages)].slice(0,2)){const image=await attempt(candidate);if(image)return image;}
  } catch {traceBench("cover.discovery","failed",{provider:"tavily",code:"search_unavailable"});}
  return null;
}
