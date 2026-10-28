'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SavedThread, ThreadPost } from '@/lib/threadsave-sync';
import { filterArchives, type LibraryFilter } from '@/lib/threadsave-library';
import styles from './ThreadsaveLibrary.module.css';

export type LibraryData = { categories: string[]; archives: SavedThread[]; accepted_at: string | null };
const time = (value: number | string) => new Date(value).toLocaleString('zh-HK', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const rootOf = (a: SavedThread) => a.posts.find(p => p.code === a.code);
const excerpt = (a: SavedThread) => rootOf(a)?.text || a.preview || a.sharedText || '媒體貼文';
async function fetchLibrary(signal?: AbortSignal): Promise<LibraryData> {
  const response = await fetch('/api/threadsave-sync', { cache: 'no-store', signal });
  if (!response.ok) throw new Error(response.status === 401 ? '登入已過期，請重新登入 Pingu。' : '未能讀取私人收藏，請確認網站已完成設定，再重新整理。');
  return response.json();
}
function depthOf(post: ThreadPost, archive: SavedThread) {
  let depth = 0, parent = post.parentCode; const seen = new Set([post.code]);
  while (parent && parent !== archive.code && !seen.has(parent) && depth < 3) {
    seen.add(parent); depth++; parent = archive.posts.find(p => p.code === parent)?.parentCode ?? '';
  }
  return depth;
}
export default function ThreadsaveLibrary({ initialData }: { initialData?: LibraryData }) {
  const [data, setData] = useState<LibraryData | null>(initialData ?? null);
  const [busy, setBusy] = useState(!initialData), [error, setError] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>({ scope: 'all', category: '', query: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false), [pairBusy, setPairBusy] = useState(false), [token, setToken] = useState(''), [pairMessage, setPairMessage] = useState('');
  async function load() {
    setBusy(true); setError('');
    try {
      setData(await fetchLibrary());
    } catch (e) { setError(e instanceof Error ? e.message : '讀取失敗，請再試。'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    void fetchLibrary(controller.signal).then(next => { if (!controller.signal.aborted) setData(next); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '讀取失敗，請再試。'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [initialData]);
  const visible = useMemo(() => filterArchives(data?.archives ?? [], filter), [data, filter]);
  const active = visible.find(a => a.code === selected);
  const count = (category?: string) => data?.archives.filter(a => a.deletedAt === 0 && (category === undefined || a.category === category)).length ?? 0;
  const choose = (scope: LibraryFilter['scope'], category = '') => { setFilter(f => ({ ...f, scope, category })); setSelected(null); };
  const scopeName = filter.scope === 'category' ? filter.category : ({ all: '全部收藏', starred: '已加星', trash: '回收筒' })[filter.scope];
  async function pair(action: 'rotate' | 'revoke') {
    if (!confirm(action === 'rotate' ? '產生新手機連線碼？舊碼會失效，網站收藏會保留。' : '撤銷手機同步權限？手機及網站收藏會保留。')) return;
    setPairBusy(true); setToken(''); setPairMessage('');
    try {
      const response = await fetch('/api/threadsave-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      if (!response.ok) throw new Error();
      const body = await response.json(); setToken(body.token ?? '');
      setPairMessage(action === 'rotate' ? '連線碼只顯示今次，請貼入 Threadsave 嘅「同步」。' : '已撤銷手機權限，現有收藏仍然保留。');
    } catch { setPairMessage('配對未能更新，請確認已登入擁有人帳戶，稍後重試。'); }
    finally { setPairBusy(false); }
  }
  return <main className={styles.library} lang="zh-Hant">
    <header className={styles.heading}><div><h1>Threadsave</h1><p>收藏嘅討論，慢慢再讀。</p></div><div className={styles.actions}>
      <span className={styles.privateLabel}>私人收藏庫</span>
      <button onClick={() => { setBusy(true); setError(''); void load(); }} disabled={busy}>{busy ? '讀取中…' : '重新整理'}</button>
      <button aria-expanded={pairing} onClick={() => { setPairing(!pairing); setToken(''); setPairMessage(''); }}>手機配對</button>
    </div></header>
    <p className={styles.freshness}>{data?.accepted_at ? `網站副本更新於 ${time(data.accepted_at)}；修改後請在手機按同步。` : '在手機按同步後，收藏會出現喺呢度。'}</p>
    {error && <p className={styles.error} role="alert">{error} <a href="/admin/login">登入</a></p>}
    {pairing && <section className={styles.pairing} aria-label="手機配對"><h2>將你嘅手機連到私人收藏庫</h2><p>1. 產生連線碼　2. 在 Threadsave 按「同步」　3. 貼上並儲存配對　4. 按「同步最新收藏」。</p><p>每次只准一部手機寫入。只同步文字、分類同資料；圖片／影片只有來源連結。</p>
      <div className={styles.actions}><button disabled={pairBusy} onClick={() => void pair('rotate')}>產生／更換連線碼</button><button disabled={pairBusy} onClick={() => void pair('revoke')}>撤銷手機權限</button></div>
      {token && <div><label htmlFor="threadsave-phone-key">手機連線碼（只交俾自己）</label><textarea id="threadsave-phone-key" readOnly value={token} rows={3} /><button onClick={async () => { try { await navigator.clipboard.writeText(token); setPairMessage('已複製連線碼。'); } catch { setPairMessage('請長按連線碼手動複製。'); } }}>複製連線碼</button></div>}
      <p role="status">{pairMessage}</p></section>}
    <div className={styles.workspace} data-reading={Boolean(active)}>
      <aside className={styles.categories} aria-label="收藏分類"><h2>你的分類</h2><div className={styles.categoryButtons}>
        <button aria-pressed={filter.scope === 'all'} onClick={() => choose('all')}><span>全部收藏</span><span>{count()}</span></button>
        <button aria-pressed={filter.scope === 'starred'} onClick={() => choose('starred')}><span>已加星</span><span>{data?.archives.filter(a => a.starred && !a.deletedAt).length ?? 0}</span></button>
        {data?.categories.map(category => <button key={category} title={category} aria-pressed={filter.scope === 'category' && filter.category === category} onClick={() => choose('category', category)}><span>{category}</span><span>{count(category)}</span></button>)}
        <button className={styles.trash} aria-pressed={filter.scope === 'trash'} onClick={() => choose('trash')}><span>回收筒</span><span>{data?.archives.filter(a => a.deletedAt > 0).length ?? 0}</span></button>
      </div></aside>
      <section className={styles.index} aria-label="收藏清單"><div className={styles.indexHead}><h2>{scopeName} <small>{visible.length}</small></h2><label htmlFor="threadsave-search" className={styles.searchLabel}>搜尋原文、留言、標籤或筆記</label><input type="search" id="threadsave-search" value={filter.query} onChange={e => { setFilter(f => ({ ...f, query: e.target.value })); setSelected(null); }} placeholder="搵返嗰篇討論…" /></div>
        <div className={styles.results}>{visible.map(a => <button className={styles.entry} key={a.code} aria-pressed={selected === a.code} onClick={() => { setSelected(a.code); window.scrollTo({ top: 0, behavior: 'instant' }); }}><span className={styles.entryTop}><strong>{rootOf(a)?.username ? `@${rootOf(a)!.username}` : 'Threads 貼文'}</strong>{a.starred && <span aria-label="已加星">★</span>}</span><span className={styles.excerpt}>{excerpt(a)}</span><span className={styles.entryMeta}><span>{a.category}</span><span>{a.posts.filter(p => p.code !== a.code).length} 則回覆</span></span><time dateTime={new Date(a.savedAt).toISOString()}>{time(a.savedAt)}</time></button>)}
        {!visible.length && !busy && <div className={styles.empty}>{data?.accepted_at ? (filter.query ? '未找到符合搜尋嘅收藏。' : '呢個分類暫時未有收藏。') : '先配對手機，再在 Threadsave 按「同步最新收藏」。'}</div>}</div>
      </section>
      <section className={styles.reader} aria-label="收藏閱讀區">{active ? <>
        <button className={styles.back} onClick={() => setSelected(null)}>返回收藏清單</button>
        <div className={styles.readerHead}><span>{active.category}{active.starred ? '　★ 已加星' : ''}{active.deletedAt ? '　回收筒' : ''}</span><a href={active.url} target="_blank" rel="noopener noreferrer">開啟來源貼文</a></div>
        <p className={styles.capture}>{active.capturedAt ? `擷取於 ${time(active.capturedAt)}` : '已存連結，尚未擷取全文'}<br />{active.captureNote}</p>
        {active.tags.length > 0 && <div className={styles.tags}>{active.tags.map((tag, i) => <span key={i}>#{tag}</span>)}</div>}
        {active.note && <aside className={styles.note}><h3>我的筆記</h3><p>{active.note}</p></aside>}
        {!rootOf(active) && <p className={styles.postText}>{active.preview || active.sharedText || active.url}</p>}
        {rootOf(active) && <Post post={rootOf(active)!} original />}
        <h2 className={styles.replyHeading}>已保存 {active.posts.filter(p => p.code !== active.code).length} 則回覆</h2>
        {active.reportedReplies !== null && <p className={styles.capture}>來源顯示 {active.reportedReplies} 則直接回覆；已存內容可含巢狀回覆，唔代表已齊。</p>}
        <div className={styles.replies}>{active.posts.filter(p => p.code !== active.code).map(p => <div key={p.code} style={{ marginInlineStart: depthOf(p, active) * 14 }}><Post post={p} /></div>)}</div>
        <p className={styles.mediaNote}>圖片／影片保留來源連結，冇上載檔案。來源連結可能過期；手機已下載檔案仍可離線閱讀。</p>
      </> : <div className={styles.readerEmpty}><span aria-hidden="true">❝</span><h2>留低，之後再讀。</h2><p>從左邊選一篇收藏。<br />原文、留言同你嘅筆記會喺度展開。</p></div>}</section>
    </div>
  </main>;
}
function Post({ post, original = false }: { post: ThreadPost; original?: boolean }) {
  return <article className={original ? styles.original : styles.reply}><p className={styles.postLabel}>{original ? '原貼文' : post.replyTo ? `回覆 @${post.replyTo}` : '已擷取回覆'}</p><h3>@{post.username || '未知作者'}</h3><p className={styles.postText}>{post.text}</p>
    {post.media.length > 0 && <div className={styles.mediaLinks}>{post.media.map((m, i) => <a key={i} href={m.url} target="_blank" rel="noopener noreferrer">{m.kind === 'video' ? '影片' : '圖片'}來源 {i + 1}</a>)}</div>}
    {post.source === 'visible' && <p className={styles.capture}>頁面可見文字；折疊內容未必已擷取。</p>}
  </article>;
}
