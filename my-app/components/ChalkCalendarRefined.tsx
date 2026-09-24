"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Script from 'next/script';
import type { Stroke } from '@/lib/chalk-sync';
import styles from './ChalkCalendarRefined.module.css';

type PublicHabit = {
    key: string; slot: number; name: string; since: string;
    particulars: string; refinements: { particulars: string; at: string }[];
};
type PublicMark = {
    habit_key: string; habit_slot: number; day: string; strokes: Stroke[]; version: number;
};
type Data = {
    published: boolean; year: number; publishedAt: string | null;
    habits: PublicHabit[]; rows: PublicMark[];
};
declare global {
    interface Window {
        Chalk?: {
            replay: (ctx: CanvasRenderingContext2D, strokes: Stroke[], x: number, y: number, size: number, options: object) => void;
        };
    }
}

const COLORS = ['#2f6b4f', '#2055c7'];
const colorFor = (slot: number) => COLORS[slot - 1] ?? COLORS[0];
const detailsAt = (habit: PublicHabit, version: number) =>
    version > 0 ? habit.refinements[version - 1]?.particulars ?? habit.particulars : habit.particulars;
const dayLabel = (day: string) => Number(day.slice(5, 7)) + '月' + Number(day.slice(8, 10)) + '日';
const dateFor = (year: number, month: number, day: number) =>
    year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');

async function fetchCalendar(): Promise<Data> {
    const response = await fetch('/api/habit-sync', { cache: 'no-store' });
    if (!response.ok) throw new Error('Calendar unavailable');
    return response.json();
}

function drawMarks(host: HTMLElement, data: Data) {
    host.querySelectorAll<HTMLCanvasElement>('canvas[data-day]').forEach(canvas => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const size = canvas.clientWidth;
        if (!size) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
        ctx.scale(dpr, dpr);
        const marks = data.rows.filter(row => row.day === canvas.dataset.day)
            .sort((a, b) => a.habit_slot - b.habit_slot);
        marks.forEach((row, index) => {
            const paired = marks.length === 2;
            const edge = paired ? size * 0.49 : size * 0.78;
            const x = paired ? index * size * 0.5 : size * 0.11;
            const y = paired ? size * 0.30 : size * 0.17;
            window.Chalk?.replay(ctx, row.strokes, x, y, edge, {
                color: colorFor(row.habit_slot), alpha: 0.96, pad: edge * 0.10,
            });
        });
    });
}

function DayDetails({ day, data }: { day: string; data: Data }) {
    const rows = data.rows.filter(row => row.day === day)
        .sort((a, b) => a.habit_slot - b.habit_slot);
    return <aside className={styles.dayDetails} aria-live="polite">
        <h3>{dayLabel(day)} · {rows.length ? '有做到' : '未有 X'}</h3>
        {rows.length ? rows.map(row => {
            const habit = data.habits.find(item => item.key === row.habit_key);
            if (!habit) return null;
            const previous = row.version > 0
                ? detailsAt(habit, row.version - 1) : '';
            return <div className={styles.record} key={row.habit_key}>
                <span className={styles.glyph} style={{ color: colorFor(habit.slot) }} aria-hidden="true">×</span>
                <div><strong>{habit.name} · {row.version ? '↗ 已調整' : '原版'}</strong>
                    <p>{detailsAt(habit, row.version) || '未有細節'}</p>
                    {previous && <small>由「{previous}」調整</small>}
                </div>
            </div>;
        }) : <p>呢日未有記錄。</p>}
    </aside>;
}

export default function ChalkCalendar() {
    const [data, setData] = useState<Data | null>(null);
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(true);
    const [ready, setReady] = useState(false);
    const [scriptError, setScriptError] = useState(false);
    const [selectedDay, setSelectedDay] = useState<string | null>(null);
    const host = useRef<HTMLElement>(null);

    async function refresh() {
        setLoading(true);
        setError(false);
        try { setData(await fetchCalendar()); }
        catch { setError(true); }
        finally { setLoading(false); }
    }
    useEffect(() => {
        let active = true;
        void fetchCalendar().then(value => { if (active) setData(value); },
            () => { if (active) setError(true); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);
    useEffect(() => {
        if (!data?.published) return;
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'numeric',
        }).formatToParts(new Date());
        const year = Number(parts.find(part => part.type === 'year')?.value);
        const month = Number(parts.find(part => part.type === 'month')?.value);
        if (data.year !== year) return;
        const frame = requestAnimationFrame(() => host.current?.querySelector<HTMLElement>(
            '[data-month="' + month + '"]')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
        return () => cancelAnimationFrame(frame);
    }, [data]);
    useEffect(() => {
        if (!data || !ready || !host.current) return;
        const draw = () => { if (host.current) drawMarks(host.current, data); };
        draw();
        window.addEventListener('resize', draw);
        return () => window.removeEventListener('resize', draw);
    }, [data, ready]);

    return <main lang="zh-Hant" className={styles.page} ref={host}>
        <Script src="/chalk-days/chalk.js" onReady={() => setReady(true)} onError={() => setScriptError(true)} />
        <header className={styles.header}><Link href="/">← pingu</Link><Link href="/admin/chalk-days">同步設定</Link></header>
        <h1>粉筆日子</h1>
        <p>每一筆，都係有做到嘅一日。</p>
        <div className={styles.legend}>{data?.habits.map(habit =>
            <span key={habit.key}><b style={{ color: colorFor(habit.slot) }}>×</b> {habit.name}</span>)}</div>
        <p className={styles.meta}>每日筆記只留喺手機。{data?.publishedAt &&
            <>最後公開：<time dateTime={data.publishedAt}>{new Date(data.publishedAt).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}（香港時間）</time></>}</p>
        <button className={styles.refresh} onClick={() => void refresh()} disabled={loading}>
            {loading ? '讀取中…' : '重新整理'}
        </button>
        {scriptError && <p role="alert" className={styles.error}>手繪顯示未能載入，請重新載入此頁。</p>}
        {error && <p role="alert" className={styles.error}>暫時讀唔到最新月曆，請稍後再試。{data && '以下保留上次讀到嘅記錄。'}</p>}
        {!loading && !error && !data?.published && <p className={styles.empty}>月曆暫時未公開。</p>}
        {data?.published && <>
            <div className={styles.habits}>{data.habits.map(habit => {
                const latest = habit.refinements.at(-1);
                return <section className={styles.habitCard} key={habit.key}>
                    <div className={styles.habitHead}><span className={styles.glyph} style={{ color: colorFor(habit.slot) }}>×</span><strong>{habit.name}</strong>
                        {latest && <span className={styles.refined}>↗ 已調整</span>}</div>
                    <p>現時細節：{latest?.particulars || habit.particulars || '未有細節'}</p>
                    {!!habit.refinements.length && <details><summary>睇調整脈絡</summary>
                        <ol><li>原版 · {habit.particulars || '未有細節'}</li>
                            {habit.refinements.map((item, index) =>
                                <li key={index}>↗ {new Date(item.at).toLocaleDateString('zh-HK', { timeZone: 'Asia/Hong_Kong' })} · {item.particulars}</li>)}</ol>
                    </details>}
                </section>;
            })}</div>
            <div className={styles.months}>{Array.from({ length: 12 }, (_, m) => {
                const month = m + 1;
                const lead = new Date(Date.UTC(data.year, m, 1)).getUTCDay();
                const count = new Date(Date.UTC(data.year, month, 0)).getUTCDate();
                const pickedHere = selectedDay?.startsWith(data.year + '-' + String(month).padStart(2, '0') + '-');
                return <section key={month} data-month={month} className={styles.month} aria-label={data.year + '年' + month + '月'}>
                    <h2>{month}月 <small>{data.year}</small></h2>
                    <div className={styles.grid}>
                        {'日一二三四五六'.split('').map(weekday => <span className={styles.weekday} key={weekday}>{weekday}</span>)}
                        {Array.from({ length: lead }, (_, i) => <span key={'blank' + i} />)}
                        {Array.from({ length: count }, (_, i) => {
                            const day = dateFor(data.year, month, i + 1);
                            const marks = data.rows.filter(row => row.day === day);
                            const names = marks.map(row => data.habits.find(habit => habit.key === row.habit_key)?.name).filter(Boolean).join('、');
                            return <button key={day} type="button" className={styles.day} aria-pressed={selectedDay === day}
                                aria-label={month + '月' + (i + 1) + '日：' + (names || '未有記錄')}
                                onClick={() => setSelectedDay(day)}>
                                <span className={styles.date}>{i + 1}</span><canvas data-day={day} aria-hidden="true" />
                            </button>;
                        })}
                    </div>
                    {pickedHere && selectedDay && <DayDetails day={selectedDay} data={data} />}
                </section>;
            })}</div>
            {!data.rows.length && <p className={styles.empty}>已公開月曆，仲未有手繪記錄。</p>}
        </>}
    </main>;
}
