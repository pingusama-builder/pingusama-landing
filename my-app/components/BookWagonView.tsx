"use client";

import BenchDiagnostics from "./BenchDiagnostics";
import { recordBenchEvent } from "@/lib/bench-diagnostics";
import { useEffect, useState, type CSSProperties } from "react";
import Image from "next/image";
import type { ResolvedShelf } from "@/lib/books";
import styles from "./BookWagonView.module.css";

export default function BookWagonView({shelf}:{shelf:ResolvedShelf}) {
  useEffect(()=>{recordBenchEvent("wagon.load","loaded",{count:shelf.currentlyReading.length+shelf.tbr.length,warnings:shelf.errors.length});},[shelf]);
  const books=[...shelf.currentlyReading.map((book,index)=>({...book,key:`reading-${index}-${book.isbn13??book.googleBooksId}`,group:"reading"})),...shelf.tbr.map((book,index)=>({...book,key:`waiting-${index}-${book.isbn13??book.googleBooksId}`,group:"waiting"}))];
  const [selected,setSelected]=useState<string|null>(books[0]?.key??null);
  const [filter,setFilter]=useState("all");const [page,setPage]=useState(0);
  const [angle,setAngle]=useState(-13);const [still,setStill]=useState(false);
  const [broken,setBroken]=useState<Record<string,boolean>>({});
  const filtered=books.filter(book=>filter==="all"||book.group===filter);
  const pageCount=Math.max(1,Math.ceil(filtered.length/3));const currentPage=Math.min(page,pageCount-1);
  const visible=filtered.slice(currentPage*3,currentPage*3+3);const active=books.find(book=>book.key===selected);
  function choose(key:string){recordBenchEvent("wagon.select","selected",{isbn:books.find(b=>b.key===key)?.isbn13});setSelected(key);const index=filtered.findIndex(book=>book.key===key);if(index>=0)setPage(Math.floor(index/3));}
  return <section data-book-wagon className={`${styles.view} ${still?styles.still:""}`} style={{"--angle":`${angle}deg`} as CSSProperties} onKeyDownCapture={event=>{if(event.key==="Escape"&&selected){event.stopPropagation();setSelected(null);}}}>
    <div className={styles.intro}><div><p className={styles.eyebrow}>THE BOOK WAGON / 私人藏書小車</p><h3>推一車，慢慢讀。</h3></div>
      <nav className={styles.tabs} aria-label="書目分類">{[["all","全部",books.length],["reading","閱讀中",shelf.currentlyReading.length],["waiting","待讀",shelf.tbr.length]].map(([value,label,count])=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>{setFilter(String(value));setPage(0);setSelected(null);}}>{label} {count}</button>)}</nav>
    </div>
    <div className={styles.layout}><div>
      <div className={styles.stage} aria-label="Vintage Book Wagon"><div className={styles.ground}/><div className={styles.anchor}><div className={styles.wagon}>
        <div className={`${styles.wheel} ${styles.c}`}/><div className={`${styles.wheel} ${styles.d}`}/>
        <div className={`${styles.board} ${styles.back} ${styles.wood}`}/><div className={`${styles.floor} ${styles.wood}`}/><div className={`${styles.board} ${styles.side} ${styles.left} ${styles.wood}`}/>
        <div className={styles.books}>{visible.map((book,index)=>{
          const asset=book.coverAsset;const ratio=asset?.width&&asset.height?asset.width/asset.height:2/3;
          const width=Math.min(148,(200+index*8)*ratio);const height=width/ratio;
          const image=book.coverUrl;const canDisplay=!!image&&!broken[image];const flat=asset?.format==="flat-front"&&canDisplay;
          return <button type="button" key={book.key} className={`${styles.book} ${flat?"":styles.photo}`} style={{"--width":`${width}px`,"--height":`${height}px`,"--thickness":"17px","--color":"#496054","--lean":`${[-3,2,5][index]}deg`} as CSSProperties} aria-label={`抽出 ${book.title}`} aria-pressed={selected===book.key} onClick={()=>choose(book.key)}>
            {flat&&<><span className={styles.spine} aria-hidden="true"/><span className={styles.pages} aria-hidden="true"/></>}
            <span className={styles.cover} aria-hidden="true">{canDisplay?<Image src={image!} alt="" width={Math.round(width)} height={Math.round(height)} unoptimized onError={()=>{recordBenchEvent("wagon.image","failed",{isbn:book.isbn13,code:"browser_image_error"});setBroken(prev=>({...prev,[image!]:true}));}}/>:<span className={styles.placeholder}><strong>{book.title}</strong><small>{book.authors.join("、")}</small><small>暫未有封面</small></span>}</span>
          </button>;
        })}</div>
        <div className={`${styles.board} ${styles.side} ${styles.wood}`}/><div className={styles.chassis}/><div className={`${styles.axle} ${styles.a}`}/><div className={`${styles.axle} ${styles.b}`}/><div className={styles.drawbar}/><div className={`${styles.board} ${styles.front} ${styles.wood}`}/><div className={`${styles.strap} ${styles.a}`}/><div className={`${styles.strap} ${styles.b}`}/><div className={styles.lettering}>PINGU&apos;S BOOK WAGON<small>STORIES FOR THE ROAD</small></div><div className={`${styles.wheel} ${styles.a}`}/><div className={`${styles.wheel} ${styles.b}`}/>
      </div></div></div>
      <div className={styles.controls}><label>轉動書車 <input type="range" min="-30" max="25" value={angle} onChange={event=>setAngle(Number(event.target.value))} aria-label="書車視角"/></label><button type="button" onClick={()=>setAngle(0)}>正面睇</button><button type="button" aria-pressed={still} onClick={()=>setStill(!still)}>減少動態</button></div>
      {pageCount>1&&<nav className={styles.pagination} aria-label="書車分頁"><button type="button" disabled={currentPage===0} onClick={()=>{setPage(currentPage-1);setSelected(null);}}>← 上一車</button><span>{currentPage+1} / {pageCount}</span><button type="button" disabled={currentPage===pageCount-1} onClick={()=>{setPage(currentPage+1);setSelected(null);}}>下一車 →</button></nav>}
    </div>
    <aside className={styles.details} aria-live="polite">{active?<>
      <div className={styles.status}>{active.group==="reading"?"閱讀中 / ON THE WAY":"待讀 / NEXT STOP"}</div><h4>{active.title}</h4><div className={styles.author}>{active.authors.join("、")||"作者資料未提供"}</div><p className={styles.note}>{active.note||"未有筆記。"}</p><div className={styles.edition}>{[active.publisher,active.publishedDate].filter(Boolean).join(" · ")||"版本資料未提供"}</div><div className={styles.edition}>{active.isbn13?`ISBN ${active.isbn13}`:"未有 ISBN"}</div>
      {active.infoLink&&<a className={styles.source} href={active.infoLink} target="_blank" rel="noopener noreferrer">查看版本來源 ↗</a>}
      <p className={styles.assetNote}>{!active.coverUrl||broken[active.coverUrl]?"暫未有可顯示封面":active.coverAsset?.format==="flat-front"?"原版封面 · 書脊及厚度為示意":active.coverAsset?.format==="product-photo"?"原版商品書照":"封面素材類型待確認 · 原圖展示"}</p><button type="button" className={styles.putback} onClick={()=>setSelected(null)}>放返書車</button>
    </>:<><div className={styles.status}>THE BOOK WAGON</div><h4>{books.length?"下一本，想讀邊本？":"書車暫時未有書。"}</h4><p className={styles.note}>{books.length?"點一下封面，睇版本資料同筆記。":"有書想讀嘅時候，再放上嚟。"}</p></>}</aside></div>
    <details className={styles.list}><summary>書目列表（{filtered.length}）</summary>{filtered.map(book=><button type="button" key={book.key} onClick={()=>choose(book.key)}>{book.title} · {book.authors.join("、")}</button>)}</details>
    {shelf.errors.length>0&&<p className={styles.assetNote}>部分書目資料未載入：{shelf.errors.map(error=>error.isbn13).join("、")}</p>}
    <BenchDiagnostics />
  </section>;
}
