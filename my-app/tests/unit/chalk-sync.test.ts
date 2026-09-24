import { describe, it, expect } from 'vitest';
import { validateSnapshot, publicCalendar, makeHandlers } from '../../lib/chalk-sync';
const payload = () => ({ schema: 1, device_id: 'dev_test', revision: 1, published: true, year: 2026,
    habits: [{ key: 'h1_test', slot: 1, name: '<img onerror=alert(1)>', since: '2026-09-22' }],
    rows: [{ device_id: 'dev_test', habit_key: 'h1_test', habit_slot: 1, day: '2026-09-22', marked_at: '2026-09-22T00:00:00Z', strokes: [{ pts: [[0.1, 0.2], [0.8, 0.9]], w: 0.085, seed: 7 }] }] });
describe('public calendar HTTP contract', () => {
    it('preserves original strokes and excludes private and device fields from public read', () => {
        const p = validateSnapshot(payload());
        const pub = publicCalendar({ published: true, payload: p, accepted_at: '2026-09-22T00:00:00Z' });
        expect(pub.rows[0].strokes).toEqual(payload().rows[0].strokes);
        expect(JSON.stringify(pub)).not.toContain('device_id');
        expect(JSON.stringify(pub)).not.toContain('marked_at');
        expect(pub.habits[0].name).toBe('<img onerror=alert(1)>');
    });
    it.each(['notes', 'token', 'owner_id'])('rejects unintended field %s', field => expect(() => validateSnapshot({ ...payload(), [field]: 'private' })).toThrow());
    it('rejects invalid calendar dates, duplicate marks and foreign habits', () => {
        const p = payload();
        p.rows[0].day = '2026-02-30';
        expect(() => validateSnapshot(p)).toThrow();
        const q = payload();
        q.rows.push(q.rows[0]);
        expect(() => validateSnapshot(q)).toThrow();
        const r = payload();
        r.rows[0].habit_key = 'foreign';
        expect(() => validateSnapshot(r)).toThrow();
    });
    it('rejects nonfinite geometry, unsupported schema and fractional revision', () => {
        const p = payload();
        p.rows[0].strokes[0].pts[0][0] = Infinity;
        expect(() => validateSnapshot(p)).toThrow();
        expect(() => validateSnapshot({ ...payload(), schema: 3 })).toThrow();
        expect(() => validateSnapshot({ ...payload(), revision: 1.1 })).toThrow();
    });
    it('allows 40 emoji code points and rejects 41', () => { const p = payload(); p.habits[0].name = '😀'.repeat(40); expect(validateSnapshot(p).habits[0].name).toBe(p.habits[0].name); p.habits[0].name += '😀'; expect(() => validateSnapshot(p)).toThrow(); });
    it('keeps the installed v1 request byte shape and projects blank particulars', () => {
        const p = validateSnapshot(payload());
        expect(p).toEqual(payload());
        const pub = publicCalendar({ published: true, payload: p, accepted_at: null });
        expect(pub.habits[0].particulars).toBe('');
        expect(pub.rows[0].version).toBe(0);
    });
    it('accepts refinement history and publishes the version behind each X', () => {
        const p = { ...payload(), schema: 2, habits: [{ ...payload().habits[0], particulars: '10 pages',
            refinements: [{ particulars: '15 pages', at: '2026-09-23T08:00:00Z' }] }],
            rows: [{ ...payload().rows[0], version: 0 }, { ...payload().rows[0], day: '2026-09-23', version: 1 }] };
        const checked = validateSnapshot(p);
        const pub = publicCalendar({ published: true, payload: checked, accepted_at: null });
        expect(pub.habits[0].refinements[0].particulars).toBe('15 pages');
        expect(pub.rows.map(r => r.version)).toEqual([0, 1]);
        expect(JSON.stringify(pub)).not.toContain('device_id');
        expect(() => validateSnapshot({ ...p, rows: [{ ...p.rows[0], version: 2 }] })).toThrow();
        expect(() => validateSnapshot({ ...p, habits: [{ ...p.habits[0], refinements: [{ particulars: '10 pages', at: '2026-09-23T08:00:00Z' }] }] })).toThrow();
    });
    it('withdrawal contains no public data', () => { expect(() => validateSnapshot({ ...payload(), published: false })).toThrow(); expect(validateSnapshot({ ...payload(), published: false, habits: [], rows: [] }).published).toBe(false); });
    it('rejects anonymous requests before reading their body or reaching storage', async () => {
        let calls = 0;
        const h = makeHandlers({ read: async () => null, publish: async () => { calls++; return { status: 200 }; } });
        const r = await h.POST(new Request('https://pingu.test/api/habit-sync', { method: 'POST', body: 'invalid' }));
        expect(r.status).toBe(401);
        expect(calls).toBe(0);
    });
    it('transmits only a hashed credential to storage and propagates conflicts', async () => {
        let captured: { hash?: string; p?: unknown; digest?: string } = {};
        const h = makeHandlers({ read: async () => null, publish: async (hash, p, digest) => { captured = { hash, p, digest }; return { status: 409 }; } });
        const token = 'a'.repeat(64);
        const r = await h.POST(new Request('https://pingu.test/api/habit-sync', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) }));
        expect(r.status).toBe(409);
        expect(captured.hash).toHaveLength(64);
        expect(captured.hash).not.toBe(token);
        expect(captured.p).toEqual(payload());
    });
    it('keeps database failures distinct from empty publication', async () => {
        const empty = makeHandlers({ read: async () => null, publish: async () => ({ status: 200 }) });
        expect((await empty.GET()).status).toBe(200);
        const fail = makeHandlers({ read: async () => { throw Error('secret connection detail'); }, publish: async () => ({ status: 200 }) });
        const r = await fail.GET();
        expect(r.status).toBe(503);
        expect(await r.text()).not.toContain('secret');
    });
});


describe('HTTP resource bounds', () => {
 it('rejects oversized bodies before storage', async () => {
  let called=false;
  const h=makeHandlers({read:async()=>null,publish:async()=>{called=true;return {status:200};}});
  const response=await h.POST(new Request('https://pingu.test/api/habit-sync',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'},body:'"'+'x'.repeat(2_000_000)+'"'}));
  expect(response.status).toBe(413);expect(called).toBe(false);
 });
 it('does not cache public data or failures',async()=>{
  const h=makeHandlers({read:async()=>null,publish:async()=>({status:401})});
  expect((await h.GET()).headers.get('cache-control')).toBe('no-store');
 });
});
