import type { BookAddInput, BookAddEvent, BookAddResult } from "./book-add-types";
import type { BenchEvent } from "./bench-diagnostics";

export class BookAddClientError extends Error {}

export async function confirmBookAdd(input:BookAddInput,onEvent:(event:BookAddEvent)=>void,fetcher:typeof fetch=fetch):Promise<BookAddResult>{
  const response=await fetcher("/api/bench/add-book",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",body:JSON.stringify(input)});
  if(!response.ok)throw new BookAddClientError(response.status===401?"登入已過期，請重新登入。":"未能開始核對，請重新載入書架後重試。");
  if(!response.body)throw new BookAddClientError("未收到進度，請重新載入書架確認結果。");
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer="",result:BookAddResult|undefined;
  const consume=(line:string)=>{
    if(!line.trim())return;
    const event=JSON.parse(line) as BookAddEvent;
    if(!["progress","trace","result"].includes(event.type))throw new BookAddClientError("進度資料無效。");
    onEvent(event);if(event.type==="result")result=event;
  };
  try{
    while(!result){
      const chunk=await reader.read();
      buffer+=decoder.decode(chunk.value,{stream:!chunk.done});
      if(buffer.length>128000)throw new BookAddClientError("進度資料過長。");
      const lines=buffer.split("\n");buffer=lines.pop()??"";
      for(const line of lines)consume(line);
      if(chunk.done){consume(buffer);break;}
    }
    if(!result)throw new BookAddClientError("連線中斷，未能確認保存結果；請重新載入書架後重試。");
    return result;
  }finally{reader.releaseLock();}
}

export function bookAddTraceMessage(event:BenchEvent):string|null{
  const provider=event.data.provider==="google"?"Google Books":event.data.provider==="openlibrary"?"Open Library":String(event.data.provider??"來源");
  switch(event.operation){
    case "book.metadata":return provider+(event.status==="started"?"：核對書籍資料…":event.status==="matched"?"：同一 ISBN 資料已找到。":"：未取得同一 ISBN 書目。");
    case "cover.lookup":return provider+"：核對版本封面…";
    case "cover.route":return event.data.code==="regional_search"?"Google Books／Open Library 未取得封面，分開搜尋 UK／US 版本來源。":"搜尋同一 ISBN 嘅版本來源。";
    case "cover.candidate":return event.status==="selected"?(event.data.market==="uk"?"UK":event.data.market==="us"?"US":"版本")+"："+(event.data.kind==="publisher"?"已識別出版社官網":event.data.kind==="retailer"?"已識別書店來源":"核對書目線索"):null;
    case "cover.evidence":return event.status==="accepted"?"來源證據與同一 ISBN 相符。":null;
    case "cover.store":return event.status==="started"?"封面已核對，正在保存圖片…":event.status==="saved"?"圖片已保存。":"圖片保存未成功。";
    case "cover.discovery":return event.status==="started"?((event.data.market==="uk"?"UK":event.data.market==="us"?"US":"版本")+"：搜尋同一 ISBN 嘅出版社及書店…"):event.status==="received"?"替補搜尋已回覆，逐一核對版本來源。":"替補搜尋暫時未能完成。";
    case "cover.extract":return event.status==="received"?"版本資料已讀取，核對 ISBN 同圖片。":"呢個來源暫時未能讀取。";
    case "cover.page":return provider+(event.status==="received"?"：版本來源已讀取。":"：來源暫時未能讀取。");
    case "cover.edition":return event.status==="matched"?"已核實同一 ISBN 嘅圖片。":"呢個來源未有可核實嘅同版本圖片。";
    case "cover.http":return event.status==="received"?"圖片已取得，核對檔案中…":"呢張圖片未能讀取，嘗試其他來源。";
    case "cover.decode":return event.status==="accepted"?"圖片可用（"+event.data.width+" × "+event.data.height+"）。":"圖片未通過核對，繼續找替補。";
    default:return null;
  }
}
