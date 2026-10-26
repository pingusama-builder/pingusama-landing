import { traceBench } from "./bench-trace";
import { canonicalIsbn } from "./isbn";
import { fetchVerifiedCoverImage, verifiedCoverSourceUrl, type CoverImage } from "./covers";
import type { CoverFailureReason } from "./book-cover-types";

type Market="uk"|"us"|"global";
interface Source {path:RegExp;imageHost:string;imagePath:RegExp;market:Market;kind:"publisher"|"retailer"|"catalogue";}
const sources:Record<string,Source>={
  "neodb.social":{path:/^\/book\/[A-Za-z0-9]+\/?$/,imageHost:"neodb.social",imagePath:/^\/m\/item\/book\//,market:"global",kind:"catalogue"},
  "imusic.co":{path:/^\/books\/\d{13}\/[a-z0-9-]+\/?$/,imageHost:"imusic.b-cdn.net",imagePath:/^\/images\/item\/original\/\d+\/\d{13}\.jpg$/,market:"global",kind:"retailer"},
  "www.bitmapbooks.com":{path:/^\/products\/[a-z0-9-]+\/?$/,imageHost:"www.bitmapbooks.com",imagePath:/^\/cdn\/shop\/(files|products)\//,market:"global",kind:"publisher"},
  "www.sanmin.com.tw":{path:/^\/product\/index\/\d+\/?$/,imageHost:"cdnec.sanmin.com.tw",imagePath:/^\/product_images\//,market:"global",kind:"retailer"},
  "www.kingstone.com.tw":{path:/^\/basic\/\d+\/?$/,imageHost:"cdn.kingstone.com.tw",imagePath:/^\/book\/images\/product\//,market:"global",kind:"retailer"},
  "www.penguinrandomhouse.com":{path:/^\/books\/\d+\/[a-z0-9-]+\/?$/,imageHost:"images.penguinrandomhouse.com",imagePath:/^\/cover\/\d{13}$/,market:"us",kind:"publisher"},
  "www.panmacmillan.com":{path:/^\/authors\/[a-z0-9-]+\/[a-z0-9-]+\/\d{13}\/?$/,imageHost:"ik.imagekit.io",imagePath:/^\/panmac\/(?:tr:[\w,.:\-]+\/)?edition\/\d{13}\.jpg$/,market:"uk",kind:"publisher"},
  "www.penguin.co.uk":{path:/^\/books\/\d+\/[a-z0-9-]+\/\d{13}\/?$/,imageHost:"cdn.penguin.co.uk",imagePath:/^\/dam-assets\/books\/\d{13}\/\d{13}-jacket-(?:large|medium|hsize)\.jpg$/,market:"uk",kind:"publisher"},
  "www.waterstones.com":{path:/^\/book\/(?:[a-z0-9-]+\/)*\d{13}\/?$/,imageHost:"cdn.waterstones.com",imagePath:/^\/bookjackets\/(?:large|medium)\/\d{4}\/\d{13}\.jpg$/,market:"uk",kind:"retailer"},
};
function publicSourceUrl(value:string):URL|null{
  try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password&&!url.port&&url.hostname.includes(".")&&!/^[\d.]+$|:|(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)?url:null;}catch{return null;}
}
function supportedPage(value:string){
  const url=publicSourceUrl(value);if(!url)return null;const source=sources[url.hostname];
  return source?.path.test(url.pathname)?{url,source}:null;
}
export function classifyCoverSource(value:string){
  const found=supportedPage(value);
  return found?{provider:found.url.hostname,market:found.source.market,kind:found.source.kind}:null;
}
function htmlAttribute(tag:string,name:string):string|undefined{return tag.match(new RegExp("\\b"+name+"\\s*=\\s*[\"']([^\"']*)[\"']","i"))?.[1]?.replace(/&amp;/gi,"&");}
function pageMeta(html:string,tag:"meta"|"link",name:string):string|undefined{
  for(const match of html.matchAll(new RegExp("<"+tag+"\\b[^>]*>","gi")))if((htmlAttribute(match[0],tag==="link"?"rel":"property")??htmlAttribute(match[0],"name"))===name)return htmlAttribute(match[0],tag==="link"?"href":"content");
}
function samePage(value:unknown,page:URL):boolean{
  if(typeof value!=="string")return false;
  try{const url=new URL(value,page);return url.protocol==="https:"&&url.hostname===page.hostname&&url.pathname.replace(/\/$/,"")===page.pathname.replace(/\/$/,"")&&url.search===page.search;}catch{return false;}
}
function imageValue(value:unknown):unknown{
  if(Array.isArray(value))value=value[0];
  return value&&typeof value==="object"?(value as Record<string,unknown>).url:value;
}
export function editionCoverFromHtml(html:string,page:string,isbn:string):string|null{
  const supported=supportedPage(page),current=publicSourceUrl(page),expected=canonicalIsbn(isbn);
  const reject=(code:string)=>{traceBench("cover.evidence","rejected",{isbn:expected,provider:current?.hostname,sourcePage:page,code});return null;};
  if(!current||!expected)return reject("invalid_identity");
  const pathIsbns:string[]=current.pathname.match(/97[89]\d{10}/g)??[];
  if(pathIsbns.length&&!pathIsbns.includes(expected))return reject("isbn_mismatch");
  const records:Record<string,unknown>[]=[];
  function visit(value:unknown){
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(!value||typeof value!=="object")return;
    const record=value as Record<string,unknown>;records.push(record);
    if(record["@graph"])visit(record["@graph"]);
    if(record.mainEntity)visit(record.mainEntity);
  }
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(match[1]));}catch{/* Malformed data is not evidence. */}
  const matching=records.filter(record=>{
    const types=Array.isArray(record["@type"])?record["@type"]:[record["@type"]];
    const isbnValue=record.isbn??record.gtin13??(current.hostname==="www.bitmapbooks.com"?record.mpn:undefined);
    if(!types.some(type=>type==="Book"||type==="Product")||!["string","number"].includes(typeof isbnValue)||canonicalIsbn(String(isbnValue))!==expected)return false;
    const offer=record.offers&&!Array.isArray(record.offers)&&typeof record.offers==="object"?record.offers as Record<string,unknown>:null;
    const identity=record.url??record.mainEntityOfPage??offer?.url??record["@id"];
    if(identity)return samePage(typeof identity==="object"?(identity as Record<string,unknown>)["@id"]:identity,current);
    if(samePage(pageMeta(html,"link","canonical"),current))return true;
    return !!supported&&["www.sanmin.com.tw","www.kingstone.com.tw"].includes(current.hostname);
  });
  if(matching.length>1)return reject("ambiguous_main_record");
  let image:unknown=matching.length?imageValue(matching[0].image)??pageMeta(html,"meta","og:image"):null;
  // Penguin UK publishes WebPage, not Book: bind both the canonical edition URL
  // and its primary image's ISBN, never recommendation images or arbitrary og:image.
  if(!matching.length&&["www.penguin.co.uk","www.waterstones.com"].includes(current.hostname)&&current.pathname.replace(/\/$/,"").endsWith("/"+expected)&&samePage(pageMeta(html,"link","canonical"),current)){
    const primary=records.filter(record=>(Array.isArray(record["@type"])?record["@type"]:[record["@type"]]).includes("WebPage")&&(!record.url||samePage(record.url,current))&&(!record["@id"]||samePage(record["@id"],current))&&record.primaryImageOfPage);
    if(primary.length===1)image=imageValue(primary[0].primaryImageOfPage);
  }
  if(typeof image!=="string")return reject(matching.length?"main_image_missing":"no_matching_edition_evidence");
  try{
    const url=new URL(image.replace(/&amp;/g,"&"));
    if(supported&&!(url.hostname===supported.source.imageHost&&supported.source.imagePath.test(url.pathname)))return reject("image_source_not_supported");
    if(["www.penguin.co.uk","www.waterstones.com","imusic.co"].includes(current.hostname)&&!verifiedCoverSourceUrl(url.toString(),expected))return reject("image_isbn_mismatch");
    const result=publicSourceUrl(url.toString())?.toString()??null;
    if(!result)return reject("unsafe_image_url");
    traceBench("cover.evidence","accepted",{isbn:expected,provider:current.hostname,sourcePage:page,imageUrl:result,code:matching.length?"exact_isbn_record":"canonical_primary_image"});
    return result;
  }catch{return reject("invalid_image_url");}
}
const requestSignal=(overall?:AbortSignal)=>overall?AbortSignal.any([overall,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000);
async function readPage(page:string,isbn?:string,overall?:AbortSignal):Promise<{html:string;page:string}|null>{
  const started=Date.now(),original=new URL(page),options={signal:requestSignal(overall),redirect:"manual" as const,next:{revalidate:0}};
  let current=page,response=await fetch(current,options);
  for(let redirects=0;response.status>=300&&response.status<400;redirects++){
    const location=response.headers.get("location");await response.body?.cancel();
    if(redirects>=2||!location)throw new Error("source_unavailable");
    const target=new URL(location,current);
    const editionRedirect=!!isbn&&target.hostname===original.hostname&&["www.penguin.co.uk","www.waterstones.com"].includes(target.hostname)&&!!supportedPage(target.toString())&&target.pathname.replace(/\/$/,"").endsWith("/"+isbn);
    if(!publicSourceUrl(target.toString())||(!samePage(target.toString(),original)&&!editionRedirect))throw new Error("unsafe_source_redirect");
    traceBench("cover.page","redirected",{isbn,sourcePage:target.toString(),httpStatus:response.status,code:"same_edition"});
    current=target.toString();response=await fetch(current,options);
  }
  traceBench("cover.page",response.ok?"received":"failed",{isbn,provider:original.hostname,sourcePage:current,httpStatus:response.status,durationMs:Date.now()-started});
  if(!response.ok&&response.status!==404&&response.status!==410)throw new Error("source_unavailable");
  if(!response.ok||!response.headers.get("content-type")?.includes("text/html")||!response.body||Number(response.headers.get("content-length"))>1_500_000)return null;
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_500_000){await reader.cancel();return null;}chunks.push(value);}
  return {html:Buffer.concat(chunks).toString("utf8"),page:current};
}
export interface CoverBookContext{title:string;authors:string[];publisher:string|null;}
type EditionImage=CoverImage&{source:"web";sourcePage:string};
export interface CoverDiscovery{image:EditionImage|null;failureReason?:CoverFailureReason;}
const normalizeIdentity=(value:string)=>value.normalize("NFKD").toLowerCase().replace(/[\p{M}\p{P}\p{Z}\s]/gu,"");
export function editionCoverFromExtract(content:string,images:string[],page:string,isbn:string,book:CoverBookContext):string|null{
  const expected=canonicalIsbn(isbn);
  const reject=(code:string)=>{traceBench("cover.evidence","rejected",{isbn:expected,sourcePage:page,code});return null;};
  if(!expected||!publicSourceUrl(page)||!book.title||!book.authors.length)return reject("incomplete_identity");
  const primary=content.slice(0,100000).split(/(?:^|\n)#{1,3}\s*(?:Books you might like|You might like|Related books|Recommended|相關書籍|推薦書籍)/i)[0];
  const title=primary.match(/^#\s+([^\n]+)/m)?.[1];
  if(!title||normalizeIdentity(title.split(/[:：]/)[0].replace(/\s*\((?:Paperback|Hardback|Hardcover)\)\s*$/i,""))!==normalizeIdentity(book.title.split(/[:：]/)[0]))return reject("title_mismatch");
  if(!book.authors.some(author=>normalizeIdentity(primary).includes(normalizeIdentity(author))))return reject("author_mismatch");
  const text=primary.replace(/!?\[([^\]]*)\]\([^)]*\)/g,"$1");
  const ids=[...text.matchAll(/ISBN(?:-1[03])?\s*[:：]?\s*([\dXx][\dXx \t-]{8,22}[\dXx])/gi),...text.matchAll(/^\s*(97[89]\d{10})\s*$/gm)].map(match=>canonicalIsbn(match[1])).filter(Boolean);
  if(new Set(ids).size!==1||ids[0]!==expected)return reject("isbn_not_unique_or_mismatched");
  const inline=[...primary.matchAll(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)(?:[^)]*)\)/g)];
  const candidates=[...new Set([...inline.map(match=>match[2]),...images.slice(0,20)].flatMap(value=>{
    const allowed=verifiedCoverSourceUrl(value,expected);
    const bound=value.includes(expected)||inline.some(match=>match[2]===value&&normalizeIdentity(match[1]).includes(normalizeIdentity(book.title.split(/[:：]/)[0])));
    return allowed&&bound?[allowed]:[];
  }))];
  if(candidates.length!==1)return reject(candidates.length?"ambiguous_images":"no_allowlisted_edition_image");
  return candidates[0];
}
async function extractEditionImage(page:string,isbn:string,book?:CoverBookContext,overall?:AbortSignal):Promise<string|null>{
  const key=process.env.TAVILY_API_KEY;if(!key||!book||!publicSourceUrl(page))return null;
  const started=Date.now();
  const response=await fetch("https://api.tavily.com/extract",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},body:JSON.stringify({urls:[page],extract_depth:"basic",format:"markdown",include_images:true}),signal:requestSignal(overall),cache:"no-store"});
  traceBench("cover.extract",response.ok?"received":"failed",{isbn,sourcePage:page,provider:"tavily",httpStatus:response.status,durationMs:Date.now()-started});
  if(!response.ok)throw new Error("source_unavailable");
  const result=await response.json() as {results?:{url?:string;raw_content?:string;images?:string[]}[];failed_results?:unknown[]};
  const found=(result.results??[]).find(item=>samePage(item.url,new URL(page))&&typeof item.raw_content==="string");
  if(!found){if(result.failed_results?.length)throw new Error("source_unavailable");return null;}
  return editionCoverFromExtract(found.raw_content!,Array.isArray(found.images)?found.images.filter(image=>typeof image==="string"):[],page,isbn,book);
}
async function acquireSource(page:string,isbn:string,book?:CoverBookContext,overall?:AbortSignal):Promise<CoverDiscovery>{
  const direct=supportedPage(page);let sourcePage=page,url:string|null=null,readFailed=false;
  traceBench("cover.source","started",{isbn,sourcePage,...classifyCoverSource(page),code:direct?"verified_source":"extracted_source"});
  if(direct){
    try{const result=await readPage(page,isbn,overall);if(result){sourcePage=result.page;url=editionCoverFromHtml(result.html,sourcePage,isbn);}}
    catch{readFailed=true;traceBench("cover.source","failed",{isbn,sourcePage,code:"direct_read_failed"});}
  }
  if(!url&&book&&process.env.TAVILY_API_KEY&&!overall?.aborted)url=await extractEditionImage(sourcePage,isbn,book,overall);
  traceBench("cover.edition",url?"matched":"missing",{isbn,provider:new URL(sourcePage).hostname,sourcePage,code:url?"exact_isbn":"no_verified_image"});
  if(!url){if(readFailed)throw new Error("source_unavailable");return {image:null,failureReason:"no-verified-cover"};}
  const image=await fetchVerifiedCoverImage(url,isbn,overall);
  return image?{image:{...image,source:"web",sourcePage}}:{image:null,failureReason:"image-unavailable"};
}
export async function rescueEditionCover(page:string|null,isbn:string,book?:CoverBookContext):Promise<EditionImage|null>{
  const exact=canonicalIsbn(isbn);if(!page||!publicSourceUrl(page)||!exact)return null;
  if(!supportedPage(page)&&(!process.env.TAVILY_API_KEY||!book))return null;
  try{return(await acquireSource(page,exact,book)).image;}catch{traceBench("cover.page","failed",{isbn:exact,sourcePage:page,code:"source_unavailable"});return null;}
}
export function publisherEditionPage(html:string,isbn:string):string|null{
  const expected=canonicalIsbn(isbn);if(!expected)return null;const pages=new Set<string>();
  for(const card of html.split(/<div\b[^>]*class=["']bibliography__item["'][^>]*>/i).slice(1)){
    const ids=[...card.matchAll(/ISBN:\s*([\d-]{10,17})/g)].map(match=>canonicalIsbn(match[1]));
    if(ids.length!==1||ids[0]!==expected)continue;
    const links=[...card.matchAll(/href=["'](\/products\/[a-z0-9-]+)["']/gi)].map(match=>match[1]),unique=[...new Set(links)];
    if(unique.length===1)pages.add("https://www.bitmapbooks.com"+unique[0]);
  }
  return pages.size===1?[...pages][0]:null;
}
const searchDomains={
  uk:["penguin.co.uk","panmacmillan.com","bitmapbooks.com","waterstones.com","faber.co.uk","bloomsbury.com","harpercollins.co.uk","blackwells.co.uk","foyles.co.uk"],
  us:["penguinrandomhouse.com","harpercollins.com","simonandschuster.com","us.macmillan.com","hachettebookgroup.com","barnesandnoble.com"],
};
export async function findEditionCover(page:string|null,isbn:string,book?:CoverBookContext):Promise<CoverDiscovery>{
  const exact=canonicalIsbn(isbn);if(!exact)return {image:null,failureReason:"isbn-required"};
  const overall=AbortSignal.timeout(40000),tried=new Set<string>();let sourceFailed=false,imageFailed=false,searchFailed=false,attempts=0;
  const key=process.env.TAVILY_API_KEY;
  const attempt=async(value:string|null)=>{
    const url=value?publicSourceUrl(value):null;if(!url||tried.has(url.toString())||overall.aborted)return null;
    if(!supportedPage(url.toString())&&(!key||!book))return null;
    tried.add(url.toString());attempts++;
    try{const result=await acquireSource(url.toString(),exact,book,overall);imageFailed ||= result.failureReason==="image-unavailable";return result.image;}
    catch{sourceFailed=true;traceBench("cover.source","failed",{isbn:exact,provider:url.hostname,sourcePage:url.toString(),code:overall.aborted?"discovery_timeout":"source_unavailable"});return null;}
  };
  const identity=page?classifyCoverSource(page):null;
  const regional=!!book&&!/\p{Script=Han}/u.test(book.title);
  const markets:Market[]=regional?(identity?.market==="us"?["us","uk"]:["uk","us"]):["global"];
  traceBench("cover.route","started",{isbn:exact,market:markets[0],code:regional?"regional_search":"global_search"});
  if(identity||!regional){const known=await attempt(page);if(known)return {image:known};}
  if(key){
    const quoted=(value:string)=>'"'+value.normalize("NFKC").replace(/["\\]/g," ").trim().slice(0,200)+'"';
    const identityTerms=book?.title&&book.authors.length?[quoted(book.title.split(/[:：]/)[0]),quoted(book.authors[0]),...(book.publisher?[quoted(book.publisher)]:[])].join(" "):null;
    const strategies=identityTerms?["isbn","identity"]:["isbn"];
    queryLoop:for(const strategy of strategies)for(const market of markets){
      if(overall.aborted||attempts>=8)break queryLoop;
      const query=[quoted(exact),...(strategy==="identity"?[identityTerms!]:[]),...(market==="global"?[]:[market.toUpperCase()]),"book cover publisher"].join(" ");
      const started=Date.now();
      traceBench("cover.discovery","started",{isbn:exact,market,strategy,query});
      try{
        const response=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},body:JSON.stringify({query,search_depth:"basic",max_results:8,include_answer:false,...(market==="global"?{}:{include_domains:searchDomains[market]})}),signal:requestSignal(overall),cache:"no-store"});
        if(!response.ok){traceBench("cover.discovery","failed",{isbn:exact,market,strategy,httpStatus:response.status,durationMs:Date.now()-started});searchFailed=true;if(response.status===429)break queryLoop;continue;}
        const result=await response.json() as {results?:{url?:string;title?:string;content?:string}[]};
        traceBench("cover.discovery","received",{isbn:exact,market,strategy,httpStatus:response.status,count:result.results?.length??0,durationMs:Date.now()-started});
        const ranked:{url:string;rank:number;score:number;kind:string}[]=[];
        const seen=new Set<string>();
        for(const [index,item]of(result.results??[]).entries()){
          const url=typeof item.url==="string"?publicSourceUrl(item.url):null;
          if(!url){traceBench("cover.candidate","skipped",{isbn:exact,market,rank:index+1,code:"unsafe_url"});continue;}
          const value=url.toString(),source=classifyCoverSource(value),pathIds:string[]=url.pathname.match(/97[89]\d{10}/g)??[];
          const code=tried.has(value)||seen.has(value)?"already_tried":pathIds.length&&!pathIds.includes(exact)?"isbn_mismatch":market!=="global"&&source&&source.market!=="global"&&source.market!==market?"market_mismatch":null;
          seen.add(value);
          if(code){traceBench("cover.candidate","skipped",{isbn:exact,market,rank:index+1,sourcePage:value,kind:source?.kind??"unverified",code});continue;}
          const score=(source?.kind==="publisher"?300:source?.kind==="retailer"?200:source?100:0)+(source?.market===market?60:0)+(pathIds.includes(exact)?80:0)+(item.content?.includes(exact)?20:0);
          ranked.push({url:value,rank:index+1,score,kind:source?.kind??"unverified"});
        }
        ranked.sort((a,b)=>b.score-a.score||a.rank-b.rank);
        for(const [index,candidate]of ranked.entries()){
          if(index>=3||attempts>=8||overall.aborted){traceBench("cover.candidate","skipped",{isbn:exact,market,sourcePage:candidate.url,rank:candidate.rank,score:candidate.score,kind:candidate.kind,code:overall.aborted?"discovery_timeout":"attempt_budget"});continue;}
          traceBench("cover.candidate","selected",{isbn:exact,market,strategy,sourcePage:candidate.url,rank:candidate.rank,score:candidate.score,kind:candidate.kind,code:"ranked_source"});
          const image=await attempt(candidate.url);if(image)return {image};
        }
      }catch{searchFailed=true;traceBench("cover.discovery","failed",{isbn:exact,market,strategy,code:overall.aborted?"discovery_timeout":"search_unavailable"});}
    }
  }
  if(regional&&!overall.aborted&&attempts<8){const known=await attempt(page);if(known)return {image:known};}
  if(!overall.aborted&&(!book||/bitmap/i.test(book.publisher??"")||identity?.provider==="www.bitmapbooks.com")){
    try{const catalog=await readPage("https://www.bitmapbooks.com/pages/bibliography",exact,overall);const publisher=await attempt(catalog?publisherEditionPage(catalog.html,exact):null);if(publisher)return {image:publisher};}
    catch{traceBench("cover.discovery","failed",{isbn:exact,provider:"bitmap",code:"catalog_unavailable"});}
  }
  if(overall.aborted)searchFailed=true;
  const failureReason:CoverFailureReason=imageFailed?"image-unavailable":searchFailed?"search-unavailable":sourceFailed?"source-unavailable":!key?"search-not-configured":"no-verified-cover";
  traceBench("cover.discovery","missing",{isbn:exact,count:attempts,code:failureReason});
  return {image:null,failureReason};
}
