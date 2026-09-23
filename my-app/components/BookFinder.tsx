"use client";
import { diagnoseBench, recordBenchEvent } from "@/lib/bench-diagnostics";

import { useState, useTransition } from "react";
import Image from "next/image";
import { searchBooksAction } from "@/app/admin/bench/actions";
import type { BookCandidate, BookLanguage, BookSearchResult } from "@/lib/book-search";
import { canonicalIsbn } from "@/lib/isbn";

interface Props { initialIsbn?:string; onSelect:(book:BookCandidate,requestedIsbn:string)=>void; }
const label = {exact:"ISBN 完全相符", "same-work":"同書名及作者 · 其他版本", "other-language":"其他語言版本",possible:"資料有差異 · 請核對",manual:"手動書目"};
const languageLabel = {"zh-Hant":"繁中","zh-Hans":"簡中",en:"英文",other:"其他語言",unknown:"語言待確認"};
const field = "w-full rounded border border-[var(--line)] bg-[var(--bg-card)] px-3 py-2 text-sm";
export default function BookFinder({initialIsbn="",onSelect}:Props) {
  const [isbn,setIsbn]=useState(initialIsbn),[title,setTitle]=useState(""),[author,setAuthor]=useState("");
  const [language,setLanguage]=useState<BookLanguage>("zh-Hant"),[alias,setAlias]=useState("");
  const [result,setResult]=useState<BookSearchResult|null>(null),[error,setError]=useState("");
  const [manual,setManual]=useState(false),[publisher,setPublisher]=useState(""),[date,setDate]=useState(""),[source,setSource]=useState("");
  const [pending,startTransition]=useTransition();
  const invalidate=()=>{setResult(null);setError("");};
  function search(otherLanguages=false) {
    setError("");setResult(null);
    startTransition(async()=>{
      try {
        const r=await diagnoseBench("book.search",()=>searchBooksAction({isbn,title,author,language,alias,otherLanguages}));
        if(r.success){setResult(r.result);recordBenchEvent("book.results","returned",{count:r.result.candidates.length,warnings:r.result.warnings.length});}else setError(r.error);
      }catch{setError("搜尋暫時失敗，請重試。");}
    });
  }
  function addManual() {
    if(!title.trim()||!author.trim()){setError("手動加入需要書名及作者。");return;}
    if(isbn.trim()&&!canonicalIsbn(isbn)){setError("ISBN 無效；唔知道可以留空。");return;}
    let link:string|null=null;
    if(source.trim()){try{const u=new URL(source);if(!/^https?:$/.test(u.protocol))throw new Error();link=u.toString();}catch{setError("來源請填 http 或 https 網址。");return;}}
    onSelect({source:"manual",match:"manual",language,book:{googleBooksId:`manual:${crypto.randomUUID()}`,title:title.trim(),authors:[author.trim()],publisher:publisher.trim()||null,publishedDate:date.trim()||null,isbn13:canonicalIsbn(isbn),isbn10:null,subtitle:null,pageCount:null,infoLink:link,thumbnail:null,coverUrl:null,coverSource:null}},initialIsbn||isbn);
  }
  return <div className="mt-3 rounded-lg border border-[var(--line)] p-4" lang="zh-Hant">
    <p className="mb-3 text-sm text-[var(--walnut-soft)]">先搵指定 ISBN；搵唔到先以書名及作者搵其他版本。</p>
    <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2 disabled:opacity-60">
      <label className="text-xs">ISBN（可留空）<input className={field} value={isbn} onChange={e=>{setIsbn(e.target.value);invalidate();}} placeholder="ISBN-10 / ISBN-13"/></label>
      <label className="text-xs">優先版本<select className={field} value={language} onChange={e=>{setLanguage(e.target.value as BookLanguage);invalidate();}}><option value="zh-Hant">繁體中文</option><option value="zh-Hans">簡體中文</option><option value="en">英文</option></select></label>
      <label className="text-xs">書名<input className={field} value={title} onChange={e=>{setTitle(e.target.value);invalidate();}} placeholder="例如：ZOO" maxLength={200}/></label>
      <label className="text-xs">作者<input className={field} value={author} onChange={e=>{setAuthor(e.target.value);invalidate();}} placeholder="例如：乙一" maxLength={120}/></label>
    </fieldset>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="pill live cursor-pointer" disabled={pending} onClick={()=>search()}>{pending?"搜尋中…":"搵書"}</button><button type="button" className="pill cursor-pointer" disabled={pending} onClick={()=>setManual(!manual)}>{manual?"收起手動輸入":"手動加入"}</button></div>
    <div role="status" aria-live="polite" className="mt-3 text-sm">
      {error&&<p className="text-[var(--terracotta-d)]">{error}</p>}
      {result?.warnings.map(w=><p key={w} className="mb-2">{w}</p>)}
      {result&&result.candidates.length===0&&<p>今次未搵到可確認嘅版本。可以補充書名、作者，或者參考下面來源。</p>}
    </div>
    <div className="mt-3 grid gap-3">{result?.candidates.map((c,i)=><article className="flex gap-3 rounded border border-[var(--line)] p-3" key={`${c.book.googleBooksId}-${i}`}>
      {c.book.coverUrl&&<Image src={c.book.coverUrl} alt="" width={48} height={72} className="h-20 w-14 object-contain" unoptimized/>}
      <div className="min-w-0 flex-1"><p className="text-xs text-[var(--terracotta-d)]">{label[c.match]}</p><p className="font-semibold break-words">{c.book.title}</p><p className="text-sm">{c.book.authors.join("、")}</p><p className="text-xs">{[languageLabel[c.language],c.book.publisher,c.book.publishedDate].filter(Boolean).join(" · ")}</p><p className="text-xs">ISBN：{c.book.isbn13||"未提供"}</p>
      {c.book.infoLink&&<a className="mr-3 text-xs underline" href={c.book.infoLink} target="_blank" rel="noreferrer">查看來源 · {c.source}</a>}<button type="button" className="pill mt-2 cursor-pointer" onClick={()=>onSelect(c,initialIsbn||isbn)}>{c.match==="possible"?"已核對，選擇此版本":"選擇此版本"}</button></div>
    </article>)}</div>
    {result?.leads.length ? <details className="mt-3 text-sm"><summary className="cursor-pointer">未確認線索（需閱讀來源）</summary><ul className="list-disc pl-5">{result.leads.map(l=><li key={l.url}><a href={l.url} target="_blank" rel="noreferrer" className="underline">{l.title}</a></li>)}</ul></details>:null}
    {result&&!result.candidates.some(c=>c.match!=="possible")&&<div className="mt-4 border-t border-[var(--line)] pt-3"><label className="block text-xs">已核實嘅其他語言書名／原名（如有）<input className={field} value={alias} onChange={e=>setAlias(e.target.value)} maxLength={200}/></label><button type="button" className="pill mt-2 cursor-pointer" disabled={pending} onClick={()=>search(true)}>再搵其他語言版本</button><p className="mt-1 text-xs">唔會自動翻譯書名；別名只用你核實過嘅資料。</p></div>}
    {manual&&<fieldset className="mt-4 grid gap-3 border-t border-[var(--line)] pt-3 sm:grid-cols-2"><p className="text-xs sm:col-span-2">沿用上面書名、作者、語言。ISBN 唔知道就留空；手動資料會標示為未經來源核實。</p><label className="text-xs">出版社<input className={field} value={publisher} onChange={e=>setPublisher(e.target.value)}/></label><label className="text-xs">出版日期<input className={field} value={date} onChange={e=>setDate(e.target.value)}/></label><label className="text-xs sm:col-span-2">來源網址（選填）<input className={field} type="url" value={source} onChange={e=>setSource(e.target.value)}/></label><button type="button" className="pill live w-fit cursor-pointer" onClick={addManual}>採用手動書目</button></fieldset>}
  </div>;
}
