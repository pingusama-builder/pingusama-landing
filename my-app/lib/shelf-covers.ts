import { traceBench } from "./bench-trace";
import { createHash } from "node:crypto";
import { fetchBookByIsbn, fetchBookByOpenLibrary, type Book, type ShelfData, type ShelfEntry } from "./books";
import type { BookCoverAsset } from "./book-cover-types";
import { fetchCoverBytes, type CoverImage } from "./covers";
import { findEditionCover } from "./book-cover-rescue";
import { mirrorCover } from "./db/books";

export function editionKey(entry: ShelfEntry): string {
  return entry.isbn13 ? `isbn:${entry.isbn13}` : `manual:${entry.selection!.book.googleBooksId}`;
}

export async function storeCoverAsset(entry:ShelfEntry,image:CoverImage,source:NonNullable<BookCoverAsset["source"]>,format:BookCoverAsset["format"],sourcePage?:string):Promise<BookCoverAsset> {
  const key=editionKey(entry);
  const sha256=createHash("sha256").update(image.bytes).digest("hex");
  const identityHash=createHash("sha256").update(key).digest("hex").slice(0,24);
  const url=await mirrorCover(`edition-${identityHash}-${sha256}`,image.bytes,image.mimeType);
  return {editionKey:key,status:"available",format,checkedAt:new Date().toISOString(),url,source,sourceUrl:image.sourceUrl,sourcePage,sha256,width:image.width,height:image.height};
}

// Never trust a cover asset supplied by the browser. Reuse only the saved server
// snapshot, keyed by the selected edition rather than the originally requested ISBN.
export async function prepareShelfCovers(shelf: ShelfData, previous: ShelfData, force = false): Promise<ShelfData> {
  const saved = new Map([...previous.currentlyReading, ...previous.tbr].filter(e=>e.selection).map(e=>[editionKey(e),e.selection!.book]));
  const resolved = new Map<string, BookCoverAsset>();
  let acquisitions = 0;
  async function prepare(entry: ShelfEntry): Promise<ShelfEntry> {
    if (!entry.selection) return entry;
    const key = editionKey(entry);
    const book = {...entry.selection.book, thumbnail:null, coverUrl:null, coverSource:null} as Book;
    const old = saved.get(key)?.coverAsset;
    let asset = resolved.get(key);
    if (!asset && old?.editionKey === key && old.status === "available" && old.url && (!force || old.source === "manual")) asset = old;
    if (!asset) {
      asset = {editionKey:key,status:"missing",format:"unreviewed",checkedAt:new Date().toISOString()};
      if (entry.isbn13) {
        // Keep one save bounded; subsequent saves/retries advance remaining books.
        if (acquisitions >= 3) { if(old?.status === "available" && old.url) asset=old; else asset.status = "pending"; }
        else {
          acquisitions++;
          try {
            // Fresh exact-ISBN metadata binds the provider's image to this edition.
            // It is used for cover acquisition only; selected bibliographic data stays intact.
            let providerFailed = false;
            const google = await fetchBookByIsbn(entry.isbn13, true).catch(()=>{providerFailed=true;return null;});
            let image = google ? await fetchCoverBytes({googleBooksId:google.googleBooksId,isbn13:null}) : null;
            if (!image) {
              const ol = await fetchBookByOpenLibrary(entry.isbn13, true).catch(()=>{providerFailed=true;return null;});
              image = await fetchCoverBytes({googleBooksId:"",isbn13:entry.isbn13,olCoverUrl:ol?.olCoverUrl});
            }
            if (image) asset = await storeCoverAsset(entry,image,image.source,"unreviewed");
            else {
              const rescued=await findEditionCover(book.infoLink,entry.isbn13);
              if (rescued) asset=await storeCoverAsset(entry,rescued,"web","unreviewed",rescued.sourcePage);
              else if (providerFailed) asset.status="failed";
            }
          } catch {
            asset.status = "failed";
          }
        }
      }
      if (old?.status === "available" && old.url && (asset.status === "missing" || asset.status === "failed")) asset={...old,refreshStatus:asset.status};
      else if (old?.sha256 && old.sha256 === asset.sha256) asset.format=old.format;
      resolved.set(key,asset);
    }
    traceBench("cover.prepare",asset.status,{isbn:entry.isbn13,provider:asset.source,code:asset.refreshStatus??"complete",format:asset.format,width:asset.width,height:asset.height});
    book.coverAsset = asset;
    if (asset.status === "available") {
      book.coverUrl = asset.url ?? null;
      book.coverSource = asset.source === "google" || asset.source === "openlibrary" ? asset.source : null;
    }
    return {...entry,selection:{...entry.selection,book}};
  }
  const entries = [...shelf.currentlyReading,...shelf.tbr];
  const pending = (entry:ShelfEntry) => entry.selection && saved.get(editionKey(entry))?.coverAsset?.status === "pending" ? 0 : 1;
  const prepared = new Map<ShelfEntry,ShelfEntry>();
  // Advance deferred entries before retrying missing covers, without changing shelf order.
  for (const entry of [...entries].sort((a,b)=>pending(a)-pending(b))) prepared.set(entry,await prepare(entry));
  return {currentlyReading:shelf.currentlyReading.map(e=>prepared.get(e)!),tbr:shelf.tbr.map(e=>prepared.get(e)!)};
}
