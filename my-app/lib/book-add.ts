import { fetchBookByIsbn, fetchBookByOpenLibrary, type Book } from "./books";
import { validateShelf } from "./book-selection";
import { canonicalIsbn } from "./isbn";
import { loadShelf, saveShelf } from "./db/bench";
import { prepareShelfCovers, editionKey } from "./shelf-covers";
import { coverFailureMessage } from "./book-cover-types";
import { traceBench } from "./bench-trace";
import type { BookAddInput, BookAddEvent, BookAddResult, BookAddStep } from "./book-add-types";

class BookAddError extends Error {}
const identity = (value:string) => value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,"");

export async function runBookAdd(input: BookAddInput, emit: (event: BookAddEvent) => void): Promise<BookAddResult> {
  let saving=false;
  const progress=(step:BookAddStep,status:"running"|"done"|"warning",message:string)=>{emit({type:"progress",step,status,message});};
  try {
    progress("metadata","running","檢查書目及 ISBN，向書籍來源重新核對資料…");
    if(!input||!["currentlyReading","tbr"].includes(input.section))throw new BookAddError("請選擇 Reading 或 TBR。");
    let entry;
    try {entry=validateShelf({currentlyReading:[input.entry],tbr:[]}).currentlyReading[0];}
    catch(error){throw new BookAddError(error instanceof Error?error.message:"書目資料無效。");}
    const warnings:string[]=[];
    let metadata:Book|null=null,source:"google"|"openlibrary"="google";
    if(entry.isbn13){
      traceBench("book.metadata","started",{isbn:entry.isbn13,provider:"google"});
      metadata=await fetchBookByIsbn(entry.isbn13,true,true).catch(()=>{warnings.push("Google Books 暫時無法核對資料。");return null;});
      if(metadata&&canonicalIsbn(metadata.isbn13??"")!==entry.isbn13)metadata=null;
      traceBench("book.metadata",metadata?"matched":"missing",{isbn:entry.isbn13,provider:"google"});
      if(!metadata){
        traceBench("book.metadata","started",{isbn:entry.isbn13,provider:"openlibrary"});
        const ol=await fetchBookByOpenLibrary(entry.isbn13,true,true).catch(()=>{warnings.push("Open Library 暫時無法核對資料。");return null;});
        if(ol&&canonicalIsbn(ol.book.isbn13??"")===entry.isbn13){metadata=ol.book;source="openlibrary";}
        traceBench("book.metadata",metadata?"matched":"missing",{isbn:entry.isbn13,provider:"openlibrary"});
      }
    }
    if(!entry.selection){
      if(!metadata)throw new BookAddError("未搵到同一 ISBN 嘅書目；請先搵書並選定版本，或採用手動書目。");
      entry={...entry,selection:{book:metadata,source,match:"exact" as const,language:"unknown" as const}};
    }
    const selected=entry.selection!.book;
    if(!metadata)warnings.push("外部書目來源未能核實資料，保留你確認嘅書名、作者及版本。");
    progress("metadata",metadata?"done":"warning",metadata?`已找到同一 ISBN 書目：${metadata.title}`:"保留已選書目；外部資料未確認。");
    progress("edition","running","核對書名、作者、版本 ISBN 同出版社…");
    if(metadata&&identity(metadata.title.split(/[:：]/)[0])!==identity(selected.title.split(/[:：]/)[0]))warnings.push("來源書名同已選書目有差異；保留你選擇嘅書名，請核對來源。");
    if(metadata?.authors.length&&selected.authors.length&&!metadata.authors.some(author=>selected.authors.some(value=>identity(author)===identity(value))))warnings.push("來源作者同已選書目有差異；保留你選擇嘅作者，請核對來源。");
    if(metadata?.publisher&&selected.publisher&&identity(metadata.publisher)!==identity(selected.publisher))warnings.push("出版社資料同來源有差異；保留所選版本，請核對來源。");
    if(!selected.authors.length)warnings.push("作者資料未提供。");
    if(!selected.publisher)warnings.push("出版社資料未提供。");
    if(!entry.isbn13)warnings.push("未提供 ISBN，版本及自動封面核對仍待確認。");
    progress("edition",warnings.length?"warning":"done",entry.isbn13?`保留所選版本 ISBN ${entry.isbn13} · ${selected.publisher||"出版社待確認"}`:"採用手動書目；版本待確認。");
    progress("cover","running","先核對 Google Books／Open Library 封面，再找同一版本嘅出版社及替補來源…");
    const previous=await loadShelf();
    const prepared=(await prepareShelfCovers({currentlyReading:[entry],tbr:[]},previous)).currentlyReading[0];
    const asset=prepared.selection?.book.coverAsset;
    const coverMessage=asset?coverFailureMessage(asset):"暫未取得封面；可以稍後重試。";
    if(asset?.status!=="available"||asset.refreshStatus){warnings.push(coverMessage||"暫未取得封面；書目仍可保存並稍後重試。");}
    progress("cover",asset?.status==="available"&&!asset.refreshStatus?"done":"warning",asset?.status==="available"?"封面已核對及保存。":coverMessage||"未取得封面；會先保存書目。");
    saving=true;
    progress("save","running","保存呢一本，保留書架其他書目、次序同備註…");
    const latest=await loadShelf();
    const key=editionKey(prepared);
    const index=latest[input.section].findIndex(value=>value.isbn13?`isbn:${value.isbn13}`===key:value.selection&&editionKey(value)===key);
    let saved=prepared;
    if(index>=0){
      const current=latest[input.section][index];
      saved=current.selection?{...current,selection:{...current.selection,book:{...current.selection.book,coverAsset:asset,coverUrl:asset?.url??null,thumbnail:null}}}:{...prepared,note:current.note};
      latest[input.section]=latest[input.section].map((value,i)=>i===index?saved:value);
    }else{
      if(latest.currentlyReading.length+latest.tbr.length>=100)throw new BookAddError("書架已達 100 本；請先移除書目。");
      latest[input.section]=[...latest[input.section],saved];
    }
    await saveShelf(latest);
    progress("save","done",index>=0?"呢個版本已在書架，已更新封面；原備註及次序保留。":"書目已加入並保存，可喺正式書架查看。");
    return {type:"result",success:true,entry:saved,warnings,alreadyPresent:index>=0};
  }catch(error){
    return {type:"result",success:false,error:error instanceof BookAddError?error.message:saving?"保存書架未成功；請重試，未確認保存前唔會顯示完成。":"書籍核對暫時未完成，請重試。"};
  }
}
