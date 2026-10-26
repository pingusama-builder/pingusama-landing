"use client";
import { diagnoseBench } from "@/lib/bench-diagnostics";
import Image from "next/image";
import { useState, useTransition } from "react";
import type { ShelfEntry } from "@/lib/books";
import type { BookCoverAsset } from "@/lib/book-cover-types";
import { coverFailureMessage } from "@/lib/book-cover-types";
import { updateBookCoverAction, retryBookCoverAction } from "@/app/admin/bench/cover-actions";

export default function BookCoverEditor({entry,disabled,onSaved}:{entry:ShelfEntry;disabled:boolean;onSaved:(asset:BookCoverAsset)=>void}) {
  const [pending,startTransition]=useTransition();const [message,setMessage]=useState("");
  const asset=entry.selection?.book.coverAsset;
  const [sourcePage,setSourcePage]=useState("");
  return <details className="mt-2 text-xs"><summary className="cursor-pointer">補封面／確認素材</summary>
    <p className="my-2">先保存版本，再自動搵同版本封面；亦可上傳圖片或確認素材類型。</p>
    {asset?.url&&<Image src={asset.url} alt="已保存來源圖片：請核對係平面封面定商品照" width={240} height={180} unoptimized className="max-h-48 w-auto object-contain my-2"/>}
    <p className="my-2">已保存圖片會自動顯示喺書卡及書車。確認為平面正封面後，書車會加上示意書脊及厚度；其他圖片會完整顯示。</p>
    <label className="block my-2">封面來源頁（選填）<input type="url" value={sourcePage} onChange={e=>setSourcePage(e.target.value)} maxLength={2000} placeholder="貼上同 ISBN 嘅書目頁" className="block w-full border rounded p-2"/></label>
    <p className="mb-2">優先核對出版社／書店版本來源，再用 ISBN、書名及作者搵替補。每張圖都會核對同一版本。</p>
    {asset&&asset.status!=="available"&&!message&&<p role="status" className="mb-2">{coverFailureMessage(asset)}</p>}
    <button type="button" className="pill cursor-pointer mb-2" disabled={disabled||pending||!asset} onClick={()=>startTransition(async()=>{setMessage("自動搜尋中…");try{const result=await diagnoseBench("cover.retry",()=>retryBookCoverAction(entry,sourcePage.trim()||undefined));if(result.success){onSaved(result.asset);setMessage(result.asset.status==="available"?(result.asset.refreshStatus?`${coverFailureMessage(result.asset)} 已保存圖片仍然保留。`:"封面已保存，書卡及書車會自動顯示。"):coverFailureMessage(result.asset));}else setMessage(result.error);}catch{setMessage("連線失敗，請重試。");}})}>{pending?"處理中…":"自動搵封面"}</button>
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
