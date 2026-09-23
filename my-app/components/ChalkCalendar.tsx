"use client";
import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import type { Stroke, Habit } from '@/lib/chalk-sync';
type Data = {
    published: boolean;
    year: number;
    publishedAt: string | null;
    habits: Habit[];
    rows: {
        habit_key: string;
        habit_slot: number;
        day: string;
        strokes: Stroke[];
    }[];
};
declare global {
    interface Window {
        Chalk?: {
            replay: (ctx: CanvasRenderingContext2D, strokes: Stroke[], x: number, y: number, size: number, options: object) => void;
        };
    }
}
async function fetchCalendar(): Promise<Data> {
    const response = await fetch('/api/habit-sync', { cache: 'no-store' });
    if (!response.ok) throw new Error('Calendar unavailable');
    return response.json();
}
export default function ChalkCalendar() {
    const [data, setData] = useState<Data | null>(null), [error, setError] = useState(false), [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [scriptError, setScriptError] = useState(false);
    const host = useRef<HTMLDivElement>(null);
    async function refresh() {
        setLoading(true); setError(false);
        try { setData(await fetchCalendar()); }
        catch { setError(true); }
        finally { setLoading(false); }
    }
    useEffect(() => {
        let active = true;
        void fetchCalendar().then(value => { if (active) setData(value); },
            () => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);
    useEffect(() => {
        if (!data?.published) return;
        const today = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'numeric',
        }).formatToParts(new Date());
        const year = Number(today.find(part => part.type === 'year')?.value);
        const month = Number(today.find(part => part.type === 'month')?.value);
        if (data.year !== year) return;
        const frame = requestAnimationFrame(() => {
            host.current?.querySelector<HTMLElement>(`[data-month="${month}"]`)
                ?.scrollIntoView({ block: 'start', behavior: 'instant' });
        });
        return () => cancelAnimationFrame(frame);
    }, [data]);
    useEffect(() => { if (!data || !ready)
        return; const draw = () => { host.current?.querySelectorAll<HTMLCanvasElement>('canvas[data-day]').forEach(cv => { const ctx = cv.getContext('2d'); if (!ctx)
        return; const size = cv.clientWidth, dpr = Math.min(devicePixelRatio || 1, 3); cv.width = size * dpr; cv.height = size * dpr; ctx.scale(dpr, dpr); for (const row of data.rows.filter(r => r.day === cv.dataset.day))
        window.Chalk?.replay(ctx, row.strokes, 0, 0, size, { color: row.habit_slot === 1 ? '#3E2C20' : '#6E8A57', alpha: 0.92, pad: size * 0.18 }); }); }; draw(); window.addEventListener('resize', draw); return () => window.removeEventListener('resize', draw); }, [data, ready]);
    return <main lang="zh-Hant" className="chalk-public" ref={host}>
 <Script src="/chalk-days/chalk.js" onReady={() => setReady(true)} onError={() => setScriptError(true)}/>
 <style>{`.chalk-public{max-width:1100px;margin:auto;padding:32px 20px 64px;color:#3e2c20;font-family:Nunito,system-ui,sans-serif}.chalk-public a{color:inherit;text-decoration:underline;text-underline-offset:4px}.chalk-public header{display:flex;gap:16px;justify-content:space-between;align-items:center;flex-wrap:wrap}.chalk-public h1{font-size:38px;margin:28px 0 4px}.chalk-public p{margin:12px 0}.chalk-public button{border:1px solid #b8a584;border-radius:18px;padding:6px 16px;cursor:pointer}.chalk-public button:disabled{opacity:.5}.chalk-months{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px 24px;margin-top:30px}.chalk-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.chalk-cell{aspect-ratio:1;position:relative;border:1px solid #b8a58466;border-radius:5px}.chalk-cell canvas{position:absolute;inset:0;width:100%;height:100%}.chalk-date{position:absolute;top:1px;left:3px;font-size:10px}.chalk-week{text-align:center;font-size:11px;opacity:.6}.chalk-public h2{margin-bottom:8px;font-size:17px}.chalk-legend{display:flex;gap:16px;flex-wrap:wrap}.chalk-legend span{overflow-wrap:anywhere}.chalk-empty{padding:40px 0;color:#786854}.chalk-error{color:#9d3c2c}@media(max-width:760px){.chalk-months{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 16px}}@media(max-width:440px){.chalk-months{grid-template-columns:1fr}.chalk-public{padding:24px 20px}.chalk-date{font-size:12px}}`}</style>
 <header><Link href="/">← pingu</Link><Link href="/admin/chalk-days">同步設定</Link></header>
 <h1>粉筆日子</h1><p>每一筆，都係有做到嘅一日。</p>
 <div className="chalk-legend">{data?.habits.map(h => <span key={h.key} style={{ color: h.slot === 1 ? '#3E2C20' : '#6E8A57' }}>● {h.name}</span>)}</div>
 <p style={{ fontSize: 13 }}>每日筆記只留喺手機。{data?.publishedAt && <>最後公開：<time dateTime={data.publishedAt}>{new Date(data.publishedAt).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}（香港時間）</time></>}</p>
 <button onClick={() => void refresh()} disabled={loading}>{loading ? '讀取中…' : '重新整理'}</button>
 {scriptError && <p role="alert" className="chalk-error">手繪顯示未能載入，請重新載入此頁。</p>}
 {error && <p role="alert" className="chalk-error">暫時讀唔到最新月曆，請稍後再試。{data && '以下保留上次讀到嘅記錄。'}</p>}
 {!loading && !error && !data?.published && <p className="chalk-empty">月曆暫時未公開。</p>}
 {data?.published && <><div className="chalk-months">{Array.from({ length: 12 }, (_, m) => { const lead = new Date(Date.UTC(data.year, m, 1)).getUTCDay(), count = new Date(Date.UTC(data.year, m + 1, 0)).getUTCDate(); return <section key={m} data-month={m + 1} style={{ scrollMarginTop: 24 }} aria-label={`${data.year}年${m + 1}月`}><h2>{m + 1}月 <small>{data.year}</small></h2><div className="chalk-grid">{'日一二三四五六'.split('').map(w => <span className="chalk-week" key={w}>{w}</span>)}{Array.from({ length: lead }, (_, i) => <span key={'blank' + i}/>)}{Array.from({ length: count }, (_, i) => { const day = `${data.year}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`; const marks = data.rows.filter(r => r.day === day); const names = marks.map(r => data.habits.find(h => h.key === r.habit_key)?.name).join('、'); return <div key={day} className="chalk-cell" role="img" aria-label={`${m + 1}月${i + 1}日：${names || '未有記錄'}`}><span className="chalk-date">{i + 1}</span><canvas data-day={day} aria-hidden="true"/></div>; })}</div></section>; })}</div>{!data.rows.length && <p className="chalk-empty">已公開月曆，仲未有手繪記錄。</p>}</>}
 </main>;
}
