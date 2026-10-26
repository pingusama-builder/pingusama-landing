"use client";
import { useState } from "react";
import { readBenchEvents, clearBenchEvents } from "@/lib/bench-diagnostics";
export default function BenchDiagnostics(){
 const [message,setMessage]=useState("");
 return <details className="mt-4 text-xs"><summary className="cursor-pointer">操作診斷</summary><p className="my-2">保留此分頁最近 500 筆事件，重新載入後仍保留。包括 ISBN、版本搜尋字詞、UK／US 分流、公開來源網址、候選排序、拒絕原因及耗時；不包括私人備註、登入資料、API key 或網址追蹤參數。</p><button type="button" className="pill cursor-pointer" onClick={()=>{const events=readBenchEvents();const blob=new Blob([JSON.stringify({schemaVersion:2,feature:"book-bench",pipelineVersion:"regional-cover-v1",exportedAt:new Date().toISOString(),events},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`pingu-bench-debug-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage(`已匯出 ${events.length} 筆事件。`);}}>匯出封面 Debug log</button> <button type="button" className="pill cursor-pointer" onClick={()=>{clearBenchEvents();setMessage("記錄已清除。");}}>清除記錄</button><p role="status">{message}</p></details>;
}
