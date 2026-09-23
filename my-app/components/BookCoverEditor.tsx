"use client";
import { diagnoseBench } from "@/lib/bench-diagnostics";
import { useState, useTransition } from "react";
import type { ShelfEntry } from "@/lib/books";
import type { BookCoverAsset } from "@/lib/book-cover-types";
import { updateBookCoverAction } from "@/app/admin/bench/cover-actions";

export default function BookCoverEditor({entry,disabled,onSaved}:{entry:ShelfEntry;disabled:boolean;onSaved:(asset:BookCoverAsset)=>void}) {
  const [pending,startTransition]=useTransition();const [message,setMessage]=useState("");
  const asset=entry.selection?.book.coverAsset;
  return <details className="mt-2 text-xs"><summary className="cursor-pointer">補封面／確認素材</summary>
    <p className="my-2">先保存版本，再上傳封面或確認圖片類型；只更新呢個版本。</p>
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
