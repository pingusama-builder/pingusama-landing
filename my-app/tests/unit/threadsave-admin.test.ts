import { beforeEach, expect, it, vi } from 'vitest';
import { digest } from '@/lib/threadsave-sync';
const stub = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: stub.user, isAdmin: (u: { app_metadata?: { role?: string } } | null) => u?.app_metadata?.role === 'admin' }));
vi.mock('@/lib/db/threadsave', () => ({ threadsaveRepository: { admin: stub.admin } }));
import { POST } from '@/app/api/threadsave-admin/route';
const request = (action = 'rotate', origin = 'https://pingu.test') => new Request('https://pingu.test/api/threadsave-admin', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
beforeEach(() => { vi.clearAllMocks(); stub.user.mockResolvedValue({ id: 'owner', app_metadata: { role: 'admin' } }); stub.admin.mockResolvedValue({ status: 200 }); });
it('refuses cross-site changes before authentication or storage', async () => { expect((await POST(request('rotate', 'https://evil.test'))).status).toBe(403); expect(stub.admin).not.toHaveBeenCalled(); });
it('refuses anonymous or non-admin sessions', async () => { for (const user of [null, { id: 'visitor' }]) { stub.user.mockResolvedValue(user); expect((await POST(request())).status).toBe(401); } expect(stub.admin).not.toHaveBeenCalled(); });
it('returns a new phone key once and stores only its digest for the verified owner', async () => {
  const response = await POST(request()); const body = await response.json(); expect(body.token).toMatch(/^[a-f0-9]{64}$/); expect(stub.admin).toHaveBeenCalledWith('owner', 'rotate', digest(body.token)); expect(response.headers.get('cache-control')).toContain('no-store');
});
it('never releases a token when DB owner verification fails', async () => { stub.admin.mockResolvedValue({ status: 403 }); const response = await POST(request()); expect(response.status).toBe(403); expect(await response.json()).not.toHaveProperty('token'); });
it('revokes the key without deleting the snapshot', async () => { expect(await (await POST(request('revoke'))).json()).toEqual({ ok: true }); expect(stub.admin).toHaveBeenCalledWith('owner', 'revoke', null); });
