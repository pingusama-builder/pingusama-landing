"use client";
import { diagnoseBench } from "@/lib/bench-diagnostics";
import { useState, useTransition } from "react";
import type { ShelfEntry } from "@/lib/books";
import type { BookCoverAsset } from "@/lib/book-cover-types";
import { updateBookCoverAction, retryBookCoverAction } from "@/app/admin/bench/cover-actions";

export default function BookCoverEditor({entry,disabled,onSaved}:{entry:ShelfEntry;disabled:boolean;onSaved:(asset:BookCoverAsset)=>void}) {
  const [pending,startTransition]=useTransition();const [message,setMessage]=useState("");
  const asset=entry.selection?.book.coverAsset;
  return <details className="mt-2 text-xs"><summary className="cursor-pointer">補封面／確認素材</summary>
    <p className="my-2">先保存版本，再自動搵同版本封面；亦可上傳圖片或確認素材類型。</p>
    <button type="button" className="pill cursor-pointer mb-2" disabled={disabled||pending||!asset} onClick={()=>startTransition(async()=>{setMessage("自動搜尋中…");try{const result=await diagnoseBench("cover.retry",()=>retryBookCoverAction(entry));if(result.success){onSaved(result.asset);setMessage(result.asset.status==="available"?(result.asset.refreshStatus?"今次未搵到新封面，保留已保存圖片。":"封面已保存；請確認素材類型。"):"暫未搵到已核實嘅同版本圖片，可以稍後重試或上傳。");}else setMessage(result.error);}catch{setMessage("連線失敗，請重試。");}})}>{pending?"處理中…":"自動搵封面"}</button>
    <form onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);startTransition(async()=>{setMessage("");const result=await diagnoseBench("cover.edit",()=>updateBookCoverAction(entry,form));if(result.success){onSaved(result.asset);setMessage("封面已保存。");}else setMessage(result.error);});}}>
      <fieldset disabled={disabled||pending||!asset} className="flex flex-col gap-2">
        <label>封面圖片（最多 3 MB）<input className="block" name="cover" type="file" accept="image/jpeg,image/png,image/webp" /></label>
        <label>素材類型 <select key={asset?.sha256+":"+asset?.format} name="format" defaultValue={asset?.format??"unreviewed"} className="border rounded p-1">
          <option value="unreviewed">未確認</option><option value="flat-front">平面正封面</option><option value="product-photo">立體商品書照</option>
        </select></label>
        <button type="submit" className="pill cursor-pointer">{pending?"保存中…":"保存封面設定"}</button>
      </fieldset>
    </form><p role="status" className="mt-2">{message}</p>
  </details>;
}
