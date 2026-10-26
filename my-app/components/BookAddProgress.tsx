"use client";
import { useState } from "react";
import { confirmBookAdd, bookAddTraceMessage, BookAddClientError } from "@/lib/book-add-client";
import { bookAddSteps, type BookAddProgress as Progress, type BookAddResult, type BookAddStep, type ShelfSection } from "@/lib/book-add-types";
import { recordBenchEvent } from "@/lib/bench-diagnostics";
import type { ShelfEntry } from "@/lib/books";

interface Props {
  section:ShelfSection;entry:ShelfEntry;disabled:boolean;
  onRunningChange:(running:boolean)=>void;onConfirmed:(entry:ShelfEntry)=>void;
}
export default function BookAddProgress({section,entry,disabled,onRunningChange,onConfirmed}:Props){
  const [running,setRunning]=useState(false);
  const [steps,setSteps]=useState<Partial<Record<BookAddStep,Progress>>>({});
  const [logs,setLogs]=useState<string[]>([]);
  const [result,setResult]=useState<BookAddResult|null>(null);
  const [status,setStatus]=useState("");
  async function confirm(){
    if(running||disabled)return;
    setRunning(true);onRunningChange(true);setResult(null);setSteps({});setLogs([]);setStatus("開始核對書籍資料…");
    recordBenchEvent("book.add","started",{isbn:entry.isbn13});
    try{
      const outcome=await confirmBookAdd({section,entry},event=>{
        if(event.type==="progress"){setSteps(previous=>({...previous,[event.step]:event}));setStatus(event.message);}
        if(event.type==="trace"){
          recordBenchEvent(event.event.operation,event.event.status,event.event.data);
          const message=bookAddTraceMessage(event.event);
          if(message){setLogs(previous=>[...previous,message].slice(-12));setStatus(message);}
        }
      });
      setResult(outcome);
      if(outcome.success){onConfirmed(outcome.entry);setStatus(outcome.warnings.length?"書目已保存，有資料或封面仍待確認。":"書目及封面已保存。");}
      else setStatus(outcome.error);
      recordBenchEvent("book.add",outcome.success?"success":"failed",{isbn:entry.isbn13});
    }catch(cause){const error=cause instanceof BookAddClientError?cause.message:"連線或處理未完成，請重新載入書架確認結果後重試。";setResult({type:"result",success:false,error});setStatus(error);recordBenchEvent("book.add","failed",{code:"transport_or_unhandled"});}
    finally{setRunning(false);onRunningChange(false);}
  }
  return <div className="mt-3 rounded border border-[var(--line)] p-3">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="pill live cursor-pointer disabled:opacity-50" disabled={disabled||running||(!entry.selection&&!entry.isbn13.trim())} onClick={confirm}>
        {running?"核對及加入中…":result?.success?"再次核對此書":"確認 Add book"}
      </button>
      <p className="text-xs text-[var(--walnut-soft)]">確認後即時處理並保存呢一本。</p>
    </div>
    <p role="status" aria-live="polite" className="mt-2 text-sm">{status}</p>
    {Object.keys(steps).length>0&&<ol aria-label="加入書籍進度" className="mt-3 grid gap-2 sm:grid-cols-2">
      {(Object.entries(bookAddSteps) as [BookAddStep,string][]).map(([step,label])=><li key={step} className="rounded bg-[var(--bg-card)] p-2 text-xs">
        <span className="font-semibold">{steps[step]?.status==="done"?"✓":steps[step]?.status==="warning"?"△":steps[step]?.status==="running"?"⟳":"○"} {label}</span>
        <p className="mt-1">{steps[step]?.message??"等待前一步完成"}</p>
      </li>)}
    </ol>}
    {logs.length>0&&<ul aria-label="即時核對結果" className="mt-3 space-y-1 text-xs text-[var(--walnut-soft)]">{logs.map((message,index)=><li key={index}>{message}</li>)}</ul>}
    {result?.success&&<div className="mt-3 text-sm">
      <p className="font-semibold">{result.alreadyPresent?"✓ 已更新書架上嘅版本":"✓ 已加入並保存"} · {result.entry.selection?.book.title}</p>
      {result.warnings.length>0&&<ul className="mt-2 list-disc pl-4 text-[var(--terracotta-d)]">{result.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
    </div>}
    {result&&!result.success&&<p role="alert" className="mt-2 text-sm text-[var(--terracotta-d)]">{result.error}</p>}
  </div>;
}
