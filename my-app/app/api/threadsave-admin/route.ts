import { randomBytes } from 'node:crypto';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { threadsaveRepository } from '@/lib/db/threadsave';
import { digest, reply } from '@/lib/threadsave-sync';

export const runtime = 'nodejs';
export async function POST(req: Request) {
  const url = new URL(req.url), host = req.headers.get('host') ?? url.host, protocol = req.headers.get('x-forwarded-proto') ?? url.protocol.slice(0, -1);
  if (!['https', 'http'].includes(protocol) || req.headers.get('origin') !== `${protocol}://${host}`) return reply({ error: 'Forbidden' }, 403);
  try {
    const user = await getCurrentUser(); if (!user || !isAdmin(user)) return reply({ error: 'Unauthorized' }, 401);
    const body = await req.text(); if (body.length > 100) return reply({ error: 'Invalid action' }, 400);
    let action: string; try { action = JSON.parse(body).action; } catch { return reply({ error: 'Invalid action' }, 400); }
    if (!['rotate', 'revoke'].includes(action)) return reply({ error: 'Invalid action' }, 400);
    const token = action === 'rotate' ? randomBytes(32).toString('hex') : null;
    const result = await threadsaveRepository.admin(user.id, action, token ? digest(token) : null);
    if (result.status !== 200) return reply({ error: 'Forbidden' }, 403);
    return reply({ ok: true, ...(token ? { token } : {}) });
  } catch { return reply({ error: '未能更新配對，請稍後再試。' }, 503); }
}
