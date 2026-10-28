import { describe, expect, it, vi } from 'vitest';
import { digest, makeHandlers, MAX_BYTES, validateSnapshot, type Snapshot, type ThreadsaveRepository } from '@/lib/threadsave-sync';

const archive = () => ({ code: 'ROOT123', url: 'https://www.threads.com/@alice/post/ROOT123', sharedText: '原分享', savedAt: 1700000000000, capturedAt: 1700000000100, category: '學習 📚', tags: ['閱讀'], note: '我的私人筆記\n保留換行', starred: true, deletedAt: 0, reportedReplies: 7, preview: '', captureNote: '留言未齊', posts: [{ code: 'ROOT123', username: 'alice', text: '原文\n<script>alert(1)</script> 📚', url: 'https://www.threads.com/@alice/post/ROOT123', parentCode: '', replyTo: '', timestamp: '', source: 'structured', media: [{ url: 'https://s.cdninstagram.com/a.jpg?x=1', kind: 'image' }] }] });
export const snapshot = () => ({ schema: 1, device_id: 'phone-one', revision: 1, categories: ['未分類', '學習 📚', '空分類'], archives: [archive()] });
const request = (body = JSON.stringify(snapshot()), token = 'a'.repeat(64)) => new Request('https://pingu.test/api/threadsave-sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body });
function setup() {
  const repo = { read: vi.fn().mockResolvedValue({ payload: snapshot(), accepted_at: '2026-10-18T00:00:00Z' }), publish: vi.fn().mockImplementation(async (_key, p, hash) => ({ status: 200, revision: p.revision, payload_hash: hash, accepted_at: '2026-10-18T00:00:00Z' })), admin: vi.fn() } satisfies ThreadsaveRepository;
  const owner = vi.fn().mockResolvedValue('owner-id');
  return { repo, owner, handlers: makeHandlers(repo, owner) };
}
describe('private Threadsave contract', () => {
  it('preserves original text, private notes, category order, empty categories, and trash', () => {
    const input = snapshot(); input.archives[0].deletedAt = 1700000000200;
    expect(validateSnapshot(input)).toEqual(input);
  });
  it('rejects hidden local paths, credentials, duplicate keys and unlisted categories', () => {
    const cases = [() => ({ ...snapshot(), cookies: 'secret' }), () => { const x = snapshot(); Object.assign(x.archives[0].posts[0].media[0], { localName: '/private/file' }); return x; }, () => { const x = snapshot(); x.archives.push(archive()); return x; }, () => ({ ...snapshot(), categories: ['未分類'] }), () => ({ ...snapshot(), revision: 0.5 })];
    for (const build of cases) expect(() => validateSnapshot(build())).toThrow();
  });
  it('rejects script links and media lookalike hosts', () => {
    for (const url of ['javascript:alert(1)', 'https://cdninstagram.com.evil.test/a.jpg', 'https://s.cdninstagram.com:8443/a.jpg', 'file:///a']) {
      const x = snapshot(); x.archives[0].posts[0].media[0].url = url;
      expect(() => validateSnapshot(x)).toThrow();
    }
  });
  it('rejects an anonymous read without touching storage', async () => {
    const x = setup(); x.owner.mockResolvedValue(null);
    const res = await x.handlers.GET(); expect(res.status).toBe(401); expect(x.repo.read).not.toHaveBeenCalled(); expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('requires database ownership in addition to verified admin', async () => {
    const x = setup(); x.repo.read.mockResolvedValue(null);
    expect((await x.handlers.GET()).status).toBe(403);
  });
  it('returns only private content and acceptance time to the owner', async () => {
    const x = setup(); const res = await x.handlers.GET(); const data = await res.json();
    expect(x.repo.read).toHaveBeenCalledWith('owner-id'); expect(data.categories).toEqual(snapshot().categories); expect(data.archives[0].note).toContain('私人'); expect(data).not.toHaveProperty('device_id'); expect(data).not.toHaveProperty('key_hash');
  });
  it('checks phone authentication before reading an oversized body', async () => {
    const x = setup(); expect((await x.handlers.POST(request('x'.repeat(MAX_BYTES + 1), 'bad'))).status).toBe(401); expect(x.repo.publish).not.toHaveBeenCalled();
  });
  it('bounds request bytes and refuses truncation', async () => {
    const x = setup(); expect((await x.handlers.POST(request('x'.repeat(MAX_BYTES + 1)))).status).toBe(413); expect(x.repo.publish).not.toHaveBeenCalled();
  });
  it('binds the receipt to exact UTF-8 request bytes, including JSON escapes', async () => {
    const x = setup(); const raw = JSON.stringify(snapshot()).replaceAll('/', '\\/'); const res = await x.handlers.POST(request(raw));
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ revision: 1, payload_hash: digest(raw) }); expect(x.repo.publish).toHaveBeenCalledWith(digest('a'.repeat(64)), expect.objectContaining({ archives: expect.any(Array) }), digest(raw));
  });
  it('propagates conflict/authentication failures without exposing DB internals', async () => {
    const x = setup(); for (const status of [401, 409]) { x.repo.publish.mockResolvedValue({ status }); expect((await x.handlers.POST(request())).status).toBe(status); }
    x.repo.publish.mockRejectedValue(new Error('private-diagnostic')); const res = await x.handlers.POST(request()); expect(res.status).toBe(503); expect(await res.text()).not.toContain('private-diagnostic');
  });
});
