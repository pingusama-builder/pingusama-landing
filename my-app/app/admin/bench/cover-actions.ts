"use server";
import { collectBenchTrace } from "@/lib/bench-trace";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { loadShelf, saveShelf } from "@/lib/db/bench";
import { validateShelf } from "@/lib/book-selection";
import { decodeCoverBytes } from "@/lib/covers";
import { editionKey, storeCoverAsset } from "@/lib/shelf-covers";
import type { ShelfEntry } from "@/lib/books";
import type { BookCoverAsset } from "@/lib/book-cover-types";

async function updateBookCoverActionInternal(input:ShelfEntry,form:FormData):Promise<{success:true;asset:BookCoverAsset}|{success:false;error:string}> {
  try {
    await requireAdmin();
    const entry=validateShelf({currentlyReading:[input],tbr:[]}).currentlyReading[0];
    if (!entry.selection) throw new Error("請先選定版本並儲存書架。");
    const format=form.get("format");
    if (format!=="flat-front" && format!=="product-photo" && format!=="unreviewed") throw new Error("請選擇封面素材類型。");
    const shelf=await loadShelf();
    const saved=[...shelf.currentlyReading,...shelf.tbr].find(e=>e.selection && editionKey(e)===editionKey(entry));
    if (!saved?.selection) throw new Error("請先儲存呢個版本，再補封面。");
    let asset=saved.selection.book.coverAsset;
    const file=form.get("cover");
    if (file instanceof File && file.size>0) {
      if (file.size>3*1024*1024) throw new Error("圖片上限為 3 MB。");
      const image=await decodeCoverBytes(Buffer.from(await file.arrayBuffer()),file.type);
      if (!image) throw new Error("圖片無法讀取；請用清晰、非動畫 JPEG、PNG 或 WebP。");
      asset=await storeCoverAsset(saved,image,"manual",format);
    } else {
      if (asset?.status!=="available" || !asset.url) throw new Error("請先上傳封面圖片。");
      if (asset.sha256!==input.selection?.book.coverAsset?.sha256) throw new Error("封面已更新，請重新載入後確認。");
      asset={...asset,format};
    }
    for (const section of ["currentlyReading","tbr"] as const) shelf[section]=shelf[section].map(e=>e.selection && editionKey(e)===editionKey(entry) ? {...e,selection:{...e.selection,book:{...e.selection.book,coverAsset:asset,coverUrl:asset.url??null,thumbnail:null}}} : e);
    await saveShelf(shelf);
    revalidatePath("/");revalidatePath("/admin/bench");
    return {success:true,asset};
  } catch(error) { return {success:false,error:error instanceof Error?error.message:"封面保存失敗。"}; }
}

export async function updateBookCoverAction(input:ShelfEntry,form:FormData){return collectBenchTrace(()=>updateBookCoverActionInternal(input,form));}
