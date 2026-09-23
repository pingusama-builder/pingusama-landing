import { canonicalIsbn } from "./isbn";
import { fetchVerifiedCoverImage, type CoverImage } from "./covers";

const sources = {
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
    if (!types.some(t=>t==="Book" || t==="Product") || typeof record.isbn!=="string" || canonicalIsbn(record.isbn)!==expected) return false;
    const identity=record.url ?? record["@id"];
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

export async function rescueEditionCover(page:string|null,isbn:string): Promise<(CoverImage & {source:"web";sourcePage:string}) | null> {
  if (!page || !supportedPage(page)) return null;
  const response=await fetch(page,{signal:AbortSignal.timeout(8000),redirect:"error",next:{revalidate:86400}});
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html") || !response.body || Number(response.headers.get("content-length"))>1_500_000) return null;
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_500_000){await reader.cancel();return null;}chunks.push(value);}
  const url=editionCoverFromHtml(Buffer.concat(chunks).toString("utf8"),page,isbn);
  if (!url) return null;
  const image=await fetchVerifiedCoverImage(url);
  return image?{...image,source:"web",sourcePage:page}:null;
}
