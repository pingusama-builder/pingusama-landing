import { config } from "dotenv";
import { fetchBookByIsbn, fetchBookByOpenLibrary } from "../lib/books";
import { fetchCoverBytes } from "../lib/covers";
import sharp from "sharp";
import { rescueEditionCover } from "../lib/book-cover-rescue";
config({path:".env.local",quiet:true});
if (process.argv.includes("--diagnose")) {
  const request = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const url = new URL(String(args[0]));
    try {
      const response = await request(...args);
      console.log(JSON.stringify({host:url.hostname,path:url.pathname,status:response.status,type:response.headers.get("content-type")}));
      if (response.headers.get("content-type")?.startsWith("image/")) {
        const bytes = Buffer.from(await response.clone().arrayBuffer());
        const metadata = await sharp(bytes).metadata().catch(()=>null);
        console.log(JSON.stringify({imageBytes:bytes.length,width:metadata?.width,height:metadata?.height,colour:metadata?.space,channels:metadata?.channels}));
      }
      return response;
    } catch { console.log(JSON.stringify({host:url.hostname,path:url.pathname,networkError:true}));throw new Error("Source request failed"); }
  };
}
async function main() {
  if(process.argv.includes("--rescue")) {
    for(const page of ["https://www.sanmin.com.tw/product/index/009463837","https://www.kingstone.com.tw/basic/2018611951367/"]) {
      const image=await rescueEditionCover(page,"9789865580704");
      console.log(JSON.stringify({page,isbn:"9789865580704",cover:image?{source:image.source,width:image.width,height:image.height,bytes:image.bytes.length}:null,persisted:false}));
    }
    return;
  }
  for (const isbn of ["9789865580704","9787020114115","9781455586691"]) {
    const google = await fetchBookByIsbn(isbn);
    let cover = google ? await fetchCoverBytes({googleBooksId:google.googleBooksId,isbn13:null}) : null;
    if (!cover) {
      const ol = await fetchBookByOpenLibrary(isbn);
      cover = await fetchCoverBytes({googleBooksId:"",isbn13:isbn,olCoverUrl:ol?.olCoverUrl});
    }
    console.log(JSON.stringify({isbn,cover:cover?{source:cover.source,width:cover.width,height:cover.height,bytes:cover.bytes.length}:null,persisted:false}));
  }
}
main().catch(()=>{console.error("Cover runtime smoke failed.");process.exitCode=1;});
