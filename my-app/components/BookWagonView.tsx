"use client";

import { coverDisplay } from "@/lib/book-cover-display";
import BenchDiagnostics from "./BenchDiagnostics";
import { recordBenchEvent } from "@/lib/bench-diagnostics";
import { useEffect, useRef, useId, useState, type CSSProperties } from "react";
import Image from "next/image";
import type { ResolvedShelf } from "@/lib/books";
import styles from "./BookWagonView.module.css";

export default function BookWagonView({shelf}:{shelf:ResolvedShelf}) {
  useEffect(()=>{recordBenchEvent("wagon.load","loaded",{count:shelf.currentlyReading.length+shelf.tbr.length,warnings:shelf.errors.length});},[shelf]);
  const books=[...shelf.currentlyReading.map((book,index)=>({...book,key:`reading-${book.isbn13||book.googleBooksId||index}`,group:"reading"})),...shelf.tbr.map((book,index)=>({...book,key:`waiting-${book.isbn13||book.googleBooksId||index}`,group:"waiting"}))];
  const [selected,setSelected]=useState<string|null>(books[0]?.key??null);
  const [page,setPage]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null);
  const dialogTitle=useId();const detailTitle=useId();
  const collectionHeading=useRef<HTMLHeadingElement>(null);
  const [collectionOpen,setCollectionOpen]=useState(false);
  const [collectionKey,setCollectionKey]=useState<string|null>(null);
  useEffect(()=>{if(!collectionOpen)return;const before=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=before;};},[collectionOpen]);
  function openCollection(){dialog.current?.showModal();setCollectionOpen(true);recordBenchEvent("wagon.tbr","opened",{count:shelf.tbr.length});}
  const [angle,setAngle]=useState(-13);const [still,setStill]=useState(false);
  const [broken,setBroken]=useState<Record<string,boolean>>({});
  const reading=books.filter(book=>book.group==="reading");const waiting=books.filter(book=>book.group==="waiting");
  const pageCount=Math.max(1,Math.ceil(reading.length/3));const currentPage=Math.min(page,pageCount-1);
  const visible=reading.slice(currentPage*3,currentPage*3+3);const active=books.find(book=>book.key===selected);
  function choose(key:string){recordBenchEvent("wagon.select","selected",{isbn:books.find(b=>b.key===key)?.isbn13});setSelected(key);const index=reading.findIndex(book=>book.key===key);if(index>=0)setPage(Math.floor(index/3));}
  function renderBook(book:(typeof books)[number],index:number,crate=false){
          const display=coverDisplay(book.coverUrl,book.coverAsset,!!book.coverUrl&&broken[book.coverUrl]);const ratio=display.ratio;
          const width=Math.min(crate?120:148,(crate?190:200+index*8)*ratio);const height=width/ratio;
          const image=display.texture;const canDisplay=!!image;const flat=canDisplay;
          return <button type="button" key={book.key} data-wagon-book={book.group} className={`${styles.book} ${flat?"":styles.photo}`} style={{"--width":`${width}px`,"--height":`${height}px`,"--thickness":"17px","--color":"#496054","--lean":`${[-3,2,5][index]}deg`} as CSSProperties} aria-label={`抽出 ${book.title}`} aria-pressed={selected===book.key} onClick={()=>choose(book.key)}>
            {flat&&<><span className={styles.spine} aria-hidden="true"/><span className={styles.pages} aria-hidden="true"/></>}
            <span className={styles.cover} aria-hidden="true">{canDisplay?<Image src={image!} alt="" width={Math.round(width)} height={Math.round(height)} unoptimized onError={()=>{recordBenchEvent("wagon.image","failed",{isbn:book.isbn13,code:"browser_image_error"});setBroken(prev=>({...prev,[image!]:true}));}}/>:<span className={styles.placeholder}><strong>{book.title}</strong><small>{book.authors.join("、")}</small><small>書名佔位 · 平面封面待補</small></span>}</span>
          </button>;

  }
  return <section data-book-wagon className={`${styles.view} ${still?styles.still:""}`} style={{"--angle":`${angle}deg`} as CSSProperties} onKeyDownCapture={event=>{if(event.key==="Escape"&&!dialog.current?.open&&selected){event.stopPropagation();setSelected(null);}}}>
    <div className={styles.intro}><div><p className={styles.eyebrow}>THE BOOK WAGON / 私人藏書小車</p><h3>正在讀，與下一本。</h3></div>
      <div className={styles.legend}><span>01 / READING · 前方書車　{reading.length}</span><span>02 / TBR · 後方木箱　{waiting.length}</span><button type="button" className={styles.openCollection} aria-haspopup="dialog" onClick={openCollection}>TBR · {waiting.length} 本　查看全部 ↗</button></div>
    </div>
    <div className={styles.layout}><div>
      <div className={styles.stage} aria-label="Vintage Book Wagon"><div className={styles.scene}><div className={styles.ground}/>
      <div className={styles.rearAnchor}><div className={styles.crate}>
        <div className={`${styles.crateBack} ${styles.wood}`}/><div className={styles.books}>{waiting.slice(0,3).map((book,index)=>renderBook(book,index,true))}</div>
        <div className={`${styles.crateSide} ${styles.wood}`}/><div className={`${styles.crateFront} ${styles.wood}`}><button type="button" aria-label={`打開待讀木箱，共 ${waiting.length} 本`} aria-haspopup="dialog" onClick={openCollection}><span>THE NEXT CHAPTER</span><small>TBR / {waiting.length} 本 · 查看全部</small></button></div><div className={`${styles.crateFoot} ${styles.a}`}/><div className={`${styles.crateFoot} ${styles.b}`}/>
      </div><div className={styles.placeLabel}>{waiting.length?`02 — TBR · 展示頭 ${Math.min(3,waiting.length)} 本／共 ${waiting.length} 本`:"02 — TBR · 等下一本"}</div></div>
      <div className={styles.anchor}><div className={styles.wagon}>
        <div className={`${styles.wheel} ${styles.c}`}/><div className={`${styles.wheel} ${styles.d}`}/>
        <div className={`${styles.board} ${styles.back} ${styles.wood}`}/><div className={`${styles.floor} ${styles.wood}`}/><div className={`${styles.board} ${styles.side} ${styles.left} ${styles.wood}`}/>
        <div className={styles.books}>{visible.map((book,index)=>renderBook(book,index))}</div>
        <div className={`${styles.board} ${styles.side} ${styles.wood}`}/><div className={styles.chassis}/><div className={`${styles.axle} ${styles.a}`}/><div className={`${styles.axle} ${styles.b}`}/><div className={styles.drawbar}/><div className={`${styles.board} ${styles.front} ${styles.wood}`}/><div className={`${styles.strap} ${styles.a}`}/><div className={`${styles.strap} ${styles.b}`}/><div className={styles.lettering}>READING WAGON<small>正在讀 · ON THE WAY</small></div><div className={`${styles.wheel} ${styles.a}`}/><div className={`${styles.wheel} ${styles.b}`}/>
      </div><div className={styles.placeLabel}>01 — READING · {reading.length?"正在旅途上":"暫時未有書"}</div></div></div></div>
      <div className={styles.controls}><label>轉動書車 <input type="range" min="-30" max="25" value={angle} onChange={event=>setAngle(Number(event.target.value))} aria-label="書車視角"/></label><button type="button" onClick={()=>setAngle(0)}>正面睇</button><button type="button" aria-pressed={still} onClick={()=>setStill(!still)}>減少動態</button></div>
      {pageCount>1&&<nav className={styles.pagination} aria-label="Reading 書車分頁"><button type="button" disabled={currentPage===0} onClick={()=>{setPage(currentPage-1);setSelected(null);}}>← 上一車</button><span>{currentPage+1} / {pageCount}</span><button type="button" disabled={currentPage===pageCount-1} onClick={()=>{setPage(currentPage+1);setSelected(null);}}>下一車 →</button></nav>}
    </div>
    <aside className={styles.details} aria-live="polite">{active?<>
      <div className={styles.status}>{active.group==="reading"?"閱讀中 / ON THE WAY":"待讀 / NEXT STOP"}</div><h4>{active.title}</h4><div className={styles.author}>{active.authors.join("、")||"作者資料未提供"}</div><p className={styles.note}>{active.note||"未有筆記。"}</p><div className={styles.edition}>{[active.publisher,active.publishedDate].filter(Boolean).join(" · ")||"版本資料未提供"}</div><div className={styles.edition}>{active.isbn13?`ISBN ${active.isbn13}`:"未有 ISBN"}</div>
      {active.infoLink&&<a className={styles.source} href={active.infoLink} target="_blank" rel="noopener noreferrer">查看版本來源 ↗</a>}
      {coverDisplay(active.coverUrl,active.coverAsset,!!active.coverUrl&&broken[active.coverUrl]).preview&&<figure className={styles.sourcePreview}><Image src={active.coverUrl!} alt={`${active.title} 來源圖片（未用作書本貼圖）`} width={240} height={180} unoptimized onError={()=>setBroken(prev=>({...prev,[active.coverUrl!]:true}))}/><figcaption>來源圖片 · 只供核對</figcaption></figure>}
      <p className={styles.assetNote}>{!active.coverUrl||broken[active.coverUrl]?"暫未有可顯示封面":active.coverAsset?.format==="flat-front"?"原版封面 · 書脊及厚度為示意":active.coverAsset?.format==="product-photo"?"商品書照只放詳情 · 車上以書名佔位":"圖片待確認 · 車上以書名佔位"}</p><button type="button" className={styles.putback} onClick={()=>setSelected(null)}>{active.group==="waiting"?"放返待讀木箱":"放返 Reading 書車"}</button>
    </>:<><div className={styles.status}>THE BOOK WAGON</div><h4>{books.length?"下一本，想讀邊本？":"書車暫時未有書。"}</h4><p className={styles.note}>{books.length?"點一下封面，睇版本資料同筆記。":"有書想讀嘅時候，再放上嚟。"}</p></>}</aside></div>
    <details className={styles.list}><summary>Reading 書目列表（{reading.length}）</summary>{reading.map(book=><button type="button" key={book.key} onClick={()=>choose(book.key)}>{book.title} · {book.authors.join("、")}</button>)}</details>
    {shelf.errors.length>0&&<p className={styles.assetNote}>部分書目資料未載入：{shelf.errors.map(error=>error.isbn13).join("、")}</p>}
    <dialog ref={dialog} className={styles.collection} aria-labelledby={dialogTitle} onClose={()=>{setCollectionOpen(false);recordBenchEvent("wagon.tbr","closed");}} onKeyDown={event=>{if(event.key==="Escape"||event.key==="Tab")event.stopPropagation();}}>
      <div className={styles.collectionHeader}><div><p className={styles.eyebrow}>THE NEXT CHAPTER</p><h4 id={dialogTitle}>待讀木箱 <small>／{waiting.length} 本</small></h4></div><button type="button" aria-label="關閉待讀清單" onClick={()=>dialog.current?.close()}>關閉 ×</button></div>
      <p className={styles.collectionIntro}>按待讀次序排列。揀一本，睇下下一站。</p>
      {(()=>{const book=waiting.find(b=>b.key===collectionKey);if(!book)return null;const display=coverDisplay(book.coverUrl,book.coverAsset,!!book.coverUrl&&broken[book.coverUrl]);return <section className={styles.collectionDetail} aria-labelledby={detailTitle}><h5 id={detailTitle} ref={collectionHeading} tabIndex={-1}>{book.title}</h5><p>{book.authors.join("、")||"作者資料未提供"} · {[book.publisher,book.publishedDate].filter(Boolean).join(" · ")||"版本資料未提供"}</p><p>{book.isbn13?`ISBN ${book.isbn13}`:"未有 ISBN"}</p><p className={styles.note}>{book.note||"未有筆記。"}</p>{book.infoLink&&<a className={styles.source} href={book.infoLink} target="_blank" rel="noopener noreferrer">查看版本來源 ↗</a>}{display.preview&&<figure className={styles.sourcePreview}><Image src={display.preview} alt={`${book.title} 來源圖片`} width={240} height={180} unoptimized onError={()=>setBroken(prev=>({...prev,[display.preview!]:true}))}/><figcaption>來源圖片 · 只供核對</figcaption></figure>}</section>;})()}
      {waiting.length===0?<p className={styles.emptyCollection}>木箱暫時空住。留個位，等下一本想讀嘅書。</p>:<div className={styles.collectionGrid}>{waiting.map((book,index)=>{const display=coverDisplay(book.coverUrl,book.coverAsset,!!book.coverUrl&&broken[book.coverUrl]);return <button type="button" key={book.key} data-tbr-book aria-label={`查看 ${book.title}`} aria-pressed={collectionKey===book.key} className={styles.collectionCard} onClick={()=>{setCollectionKey(book.key);recordBenchEvent("wagon.tbr.select","selected",{isbn:book.isbn13});requestAnimationFrame(()=>{dialog.current?.scrollTo(0,0);collectionHeading.current?.focus({preventScroll:true});});}}><span className={styles.collectionCover} aria-hidden="true">{display.texture?<Image src={display.texture} alt="" width={160} height={200} unoptimized onError={()=>{recordBenchEvent("wagon.image","failed",{isbn:book.isbn13,code:"browser_image_error"});setBroken(prev=>({...prev,[display.texture!]:true}));}}/>:<span className={styles.placeholder}><strong>{book.title}</strong><small>平面封面待補</small></span>}</span><strong>{book.title}</strong><small>{String(index+1).padStart(2,"0")} / {book.authors.join("、")||"作者資料未提供"}</small></button>;})}</div>}
    </dialog>
    <BenchDiagnostics />
  </section>;
}
