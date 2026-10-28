import { createHash } from 'node:crypto';

export type MediaLink = { url: string; kind: 'image' | 'video' };
export type ThreadPost = { code: string; username: string; text: string; url: string; parentCode: string; replyTo: string; timestamp: string; source: string; media: MediaLink[] };
export type SavedThread = { code: string; url: string; sharedText: string; savedAt: number; capturedAt: number; category: string; tags: string[]; note: string; starred: boolean; deletedAt: number; reportedReplies: number | null; preview: string; captureNote: string; posts: ThreadPost[] };
export type Snapshot = { schema: 1; device_id: string; revision: number; categories: string[]; archives: SavedThread[] };
export type Receipt = { status: number; revision?: number; accepted_at?: string; payload_hash?: string };
export interface ThreadsaveRepository {
  read(owner: string): Promise<{ payload: Snapshot | null; accepted_at: string | null } | null>;
  publish(keyHash: string, payload: Snapshot, payloadHash: string): Promise<Receipt>;
  admin(owner: string, action: string, keyHash: string | null): Promise<{ status: number }>;
}
export const MAX_BYTES = 4_000_000;
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie' } });
const invalid = (): never => { throw new Error('Invalid archive'); };
function object(x: unknown, fields: string[]): Record<string, unknown> {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return invalid();
  const value = x as Record<string, unknown>;
  if (Object.keys(value).length !== fields.length || fields.some(k => !(k in value))) return invalid();
  return value;
}
function text(x: unknown, max: number): string { return typeof x === 'string' && x.length <= max && !x.includes('\u0000') ? x : invalid(); }
function integer(x: unknown): number { return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : invalid(); }
function list(x: unknown, max: number): unknown[] { return Array.isArray(x) && x.length <= max ? x : invalid(); }
function code(x: unknown): string { const s = text(x, 100); return /^[A-Za-z0-9_-]{3,100}$/.test(s) ? s : invalid(); }
function url(x: unknown, media = false, postCode = ''): string {
  const s = text(x, 16000); let u: URL;
  try { u = new URL(s); } catch { return invalid(); }
  const hosts = media ? ['cdninstagram.com', 'fbcdn.net', 'threads.com', 'threads.net'] : ['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'];
  const allowed = media ? hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h)) : hosts.includes(u.hostname);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !allowed) return invalid();
  if (!media && (!/^\/(?:@[A-Za-z0-9_.]{1,100}\/post|t)\/[A-Za-z0-9_-]{3,100}\/?$/.test(u.pathname) || u.pathname.replace(/\/$/, '').split('/').at(-1) !== postCode)) return invalid();
  return s;
}
export function validateSnapshot(input: unknown): Snapshot {
  const x = object(input, ['schema', 'device_id', 'revision', 'categories', 'archives']);
  if (x.schema !== 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(text(x.device_id, 64)) || integer(x.revision) < 1) return invalid();
  const categories = list(x.categories, 1000).map(v => text(v, 80));
  if (categories.some(c => !c.trim()) || new Set(categories).size !== categories.length) return invalid();
  const seen = new Set<string>(); let totalPosts = 0;
  for (const raw of list(x.archives, 5000)) {
    const a = object(raw, ['code', 'url', 'sharedText', 'savedAt', 'capturedAt', 'category', 'tags', 'note', 'starred', 'deletedAt', 'reportedReplies', 'preview', 'captureNote', 'posts']);
    const id = code(a.code); if (seen.has(id)) return invalid(); seen.add(id); url(a.url, false, id);
    if (!categories.includes(text(a.category, 80)) || typeof a.starred !== 'boolean') return invalid();
    text(a.sharedText, 200000); text(a.note, 10000); text(a.preview, 300000); text(a.captureNote, 2000);
    for (const value of [a.savedAt, a.capturedAt, a.deletedAt]) if (integer(value) > 8_640_000_000_000_000) return invalid();
    if (a.reportedReplies !== null) integer(a.reportedReplies);
    list(a.tags, 20).forEach(t => text(t, 1000)); const posts = new Set<string>();
    for (const rawPost of list(a.posts, 5000)) {
      if (++totalPosts > 50000) return invalid();
      const p = object(rawPost, ['code', 'username', 'text', 'url', 'parentCode', 'replyTo', 'timestamp', 'source', 'media']);
      const id = code(p.code); if (posts.has(id)) return invalid(); posts.add(id); url(p.url, false, id);
      text(p.username, 100); text(p.text, 300000); text(p.parentCode, 100); text(p.replyTo, 100); text(p.timestamp, 100); text(p.source, 40);
      for (const rawMedia of list(p.media, 50)) { const m = object(rawMedia, ['url', 'kind']); url(m.url, true); if (m.kind !== 'image' && m.kind !== 'video') return invalid(); }
    }
  }
  return input as Snapshot;
}
async function readBody(req: Request): Promise<string> {
  const reader = req.body?.getReader(); if (!reader) return invalid();
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { await reader.cancel(); throw new RangeError(); } chunks.push(value); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
export function makeHandlers(repo: ThreadsaveRepository, owner: () => Promise<string | null>) {
  return {
    async GET() {
      try {
        const id = await owner(); if (!id) return reply({ error: 'Unauthorized' }, 401);
        const row = await repo.read(id); if (!row) return reply({ error: 'Forbidden' }, 403);
        return reply({ categories: row.payload?.categories ?? [], archives: row.payload?.archives ?? [], accepted_at: row.accepted_at });
      } catch { return reply({ error: '收藏暫時無法讀取，請稍後重試。' }, 503); }
    },
    async POST(req: Request) {
      const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization') ?? '')?.[1];
      if (!token) return reply({ error: 'Unauthorized' }, 401);
      if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'JSON required' }, 415);
      let raw: string; let payload: Snapshot;
      try { raw = await readBody(req); payload = validateSnapshot(JSON.parse(raw)); }
      catch (e) { return reply({ error: e instanceof RangeError ? '收藏文字超過 4 MB，未有截斷或覆蓋網站資料。' : '收藏格式未能識別，請更新 App。' }, e instanceof RangeError ? 413 : 400); }
      try {
        const result = await repo.publish(digest(token), payload, digest(raw));
        return result.status === 200 ? reply({ revision: result.revision, accepted_at: result.accepted_at, payload_hash: result.payload_hash }) : reply({ error: result.status === 401 ? '手機配對已失效，請重新配對。' : '同步版本衝突，請重新配對後再試。' }, result.status);
      } catch { return reply({ error: '同步暫未完成，待同步資料已保留。' }, 503); }
    },
  };
}
