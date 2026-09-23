"use client";
import { useState } from "react";
import { readBenchEvents, clearBenchEvents } from "@/lib/bench-diagnostics";
export default function BenchDiagnostics(){
 const [message,setMessage]=useState("");
 return <details className="mt-4 text-xs"><summary className="cursor-pointer">操作診斷</summary><p className="my-2">保留此分頁最近 200 筆事件，重新載入後仍保留。包括 ISBN、流程結果及耗時；不包括筆記、搜尋文字、圖片或登入資料。</p><button type="button" className="pill cursor-pointer" onClick={()=>{const events=readBenchEvents();const blob=new Blob([JSON.stringify({schemaVersion:1,feature:"book-wagon",exportedAt:new Date().toISOString(),events},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`pingu-bench-debug-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage(`已匯出 ${events.length} 筆事件。`);}}>匯出診斷 JSON</button> <button type="button" className="pill cursor-pointer" onClick={()=>{clearBenchEvents();setMessage("記錄已清除。");}}>清除記錄</button><p role="status">{message}</p></details>;
}
