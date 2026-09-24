import { createHash } from 'node:crypto';
export type Stroke = {
    pts: number[][];
    w: number;
    seed: number;
};
export type Habit = {
    key: string;
    slot: number;
    name: string;
    since: string;
    particulars?: string;
    refinements?: { particulars: string; at: string }[];
};
export type Mark = {
    device_id: string;
    habit_key: string;
    habit_slot: number;
    day: string;
    marked_at: string;
    strokes: Stroke[];
    version?: number;
};
export type Snapshot = {
    schema: 1 | 2;
    device_id: string;
    revision: number;
    published: boolean;
    year: 2026;
    habits: Habit[];
    rows: Mark[];
};
export type StoredCalendar = {
    published: boolean;
    payload: Snapshot;
    accepted_at: string | null;
};
export const MAX_BYTES = 2000000;
function fail(): never { throw new Error('Invalid calendar'); }
const obj = (x: unknown): Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : fail();
function keys(x: Record<string, unknown>, names: string[]) { if (Object.keys(x).length !== names.length || names.some(k => !(k in x)))
    fail(); }
const text = (x: unknown, max: number): string => typeof x === 'string' && x.length > 0 && Array.from(x).length <= max && !/[\u0000-\u001f\u007f]/.test(x) ? x : fail();
const particulars = (x: unknown, empty = false): string => {
    if (empty && x === '') return '';
    const s = text(x, 120);
    if (s.trim() !== s) fail();
    return s;
};
const int = (x: unknown, min: number, max: number): number => typeof x === 'number' && Number.isSafeInteger(x) && x >= min && x <= max ? x : fail();
function date(x: unknown) { const s = text(x, 10); if (!/^2026-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s)
    fail(); return s; }
function timestamp(x: unknown) { const s = text(x, 40); if (!/^\d{4}-\d\d-\d\dT/.test(s) || !Number.isFinite(Date.parse(s))) fail(); return s; }
function list(x: unknown, max: number): unknown[] { return Array.isArray(x) && x.length <= max ? x : fail(); }
export function validateSnapshot(input: unknown): Snapshot {
    const x = obj(input);
    keys(x, ['schema', 'device_id', 'revision', 'published', 'year', 'habits', 'rows']);
    if ((x.schema !== 1 && x.schema !== 2) || x.year !== 2026 || typeof x.published !== 'boolean')
        fail();
    const schema = x.schema;
    const device = text(x.device_id, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(device))
        fail();
    const revision = int(x.revision, 0, Number.MAX_SAFE_INTEGER);
    const usedSlots = new Set<number>(), usedKeys = new Set<string>();
    const habits: Habit[] = list(x.habits, 2).map(raw => { const h = obj(raw); keys(h, schema === 1 ? ['key', 'slot', 'name', 'since'] : ['key', 'slot', 'name', 'since', 'particulars', 'refinements']); const key = text(h.key, 64), slot = int(h.slot, 1, 2), name = text(h.name, 40); if (!/^[a-zA-Z0-9_-]+$/.test(key) || name.trim() !== name || usedSlots.has(slot) || usedKeys.has(key))
        fail(); usedSlots.add(slot); usedKeys.add(key);
        const base = { key, slot, name, since: date(h.since) };
        if (schema === 1) return base;
        const first = particulars(h.particulars, true);
        let previous = first;
        const refinements = list(h.refinements, 365).map(raw => {
            const r = obj(raw); keys(r, ['particulars', 'at']);
            const detail = particulars(r.particulars);
            if (detail === previous) fail();
            previous = detail;
            return { particulars: detail, at: timestamp(r.at) };
        });
        return { ...base, particulars: first, refinements };
    });
    const seen = new Set<string>();
    let points = 0;
    const rows = list(x.rows, 730).map(raw => {
        const r = obj(raw);
        keys(r, schema === 1 ? ['device_id', 'habit_key', 'habit_slot', 'day', 'marked_at', 'strokes'] : ['device_id', 'habit_key', 'habit_slot', 'day', 'marked_at', 'strokes', 'version']);
        const h = habits.find(h => h.key === r.habit_key && h.slot === r.habit_slot);
        if (!h || r.device_id !== device)
            fail();
        const day = date(r.day), id = h.key + ':' + day;
        if (seen.has(id))
            fail();
        seen.add(id);
        const marked_at = timestamp(r.marked_at);
        const version = schema === 2 ? int(r.version, 0, h.refinements?.length ?? 0) : undefined;
        const strokes = list(r.strokes, 128).map(raw => { const s = obj(raw); keys(s, ['pts', 'w', 'seed']); const pts = list(s.pts, 4096).map(raw => { const a = list(raw, 2); if (a.length !== 2 || a.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 16))
            fail(); points++; if (points > 200000)
            fail(); return a as number[]; }); if (!pts.length || typeof s.w !== 'number' || !Number.isFinite(s.w) || s.w <= 0 || s.w > 0.5)
            fail(); return { pts, w: s.w, seed: int(s.seed, -2147483648, 2147483647) }; });
        if (!strokes.length)
            fail();
        return schema === 1 ? { device_id: device, habit_key: h.key, habit_slot: h.slot, day, marked_at, strokes }
            : { device_id: device, habit_key: h.key, habit_slot: h.slot, day, marked_at, strokes, version };
    });
    if (!x.published && (habits.length || rows.length))
        fail();
    return { schema, device_id: device, revision, published: x.published, year: 2026, habits, rows };
}
export function publicCalendar(row: StoredCalendar | null) { return { published: row?.published === true, year: 2026, publishedAt: row?.accepted_at ?? null,
    habits: row?.published ? row.payload.habits.map(h => ({ key: h.key, slot: h.slot, name: h.name, since: h.since,
        particulars: h.particulars ?? '', refinements: h.refinements ?? [] })) : [],
    rows: row?.published ? row.payload.rows.map(r => ({ habit_key: r.habit_key, habit_slot: r.habit_slot, day: r.day, strokes: r.strokes,
        version: r.version ?? 0 })) : [] }; }
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export interface CalendarRepository {
    read(): Promise<StoredCalendar | null>;
    publish(keyHash: string, payload: Snapshot, payloadHash: string): Promise<{
        status: number;
        revision?: number;
        accepted_at?: string;
        published?: boolean;
    }>;
}
export function reply(body: unknown, status = 200) { return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
async function body(req: Request) { const reader = req.body?.getReader(); if (!reader)
    fail(); const chunks: Uint8Array[] = []; let total = 0; for (;;) {
    const { value, done } = await reader.read();
    if (done)
        break;
    total += value.length;
    if (total > MAX_BYTES) {
        await reader.cancel();
        throw new RangeError('Too large');
    }
    chunks.push(value);
} return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
export function makeHandlers(repo: CalendarRepository) {
    return {
        async GET() { try {
            return reply(publicCalendar(await repo.read()));
        }
        catch {
            return reply({ error: 'Calendar unavailable' }, 503);
        } },
        async POST(req: Request) {
            const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization') ?? '');
            if (!match)
                return reply({ error: 'Unauthorized' }, 401);
            if (!req.headers.get('content-type')?.startsWith('application/json'))
                return reply({ error: 'JSON required' }, 415);
            let p: Snapshot;
            try {
                p = validateSnapshot(await body(req));
            }
            catch (e) {
                return reply({ error: e instanceof RangeError ? 'Calendar too large' : 'Invalid calendar' }, e instanceof RangeError ? 413 : 400);
            }
            try {
                const result = await repo.publish(digest(match[1]), p, digest(JSON.stringify(p)));
                return result.status === 200 ? reply({ revision: result.revision, accepted_at: result.accepted_at, published: result.published }) : reply({ error: result.status === 401 ? 'Unauthorized' : 'Calendar revision conflict' }, result.status);
            }
            catch {
                return reply({ error: 'Sync unavailable; retry later' }, 503);
            }
        }
    };
}
