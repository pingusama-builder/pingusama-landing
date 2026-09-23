import { randomBytes } from 'node:crypto';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { digest, reply } from '@/lib/chalk-sync';
export const runtime = 'nodejs';
export async function POST(req: Request) {
    // Next may normalize req.url to an internal hostname behind the proxy.
    // Host is browser-controlled by the destination, not by cross-site JS.
    const url = new URL(req.url);
    const host = req.headers.get('host') ?? url.host;
    const protocol = req.headers.get('x-forwarded-proto') ?? url.protocol.slice(0, -1);
    if (!['http', 'https'].includes(protocol) || req.headers.get('origin') !== `${protocol}://${host}`)
        return reply({ error: 'Forbidden' }, 403);
    const user = await getCurrentUser();
    if (!user || !isAdmin(user))
        return reply({ error: 'Unauthorized' }, 401);
    let action: string;
    try {
        action = (await req.json()).action;
    }
    catch {
        return reply({ error: 'Invalid request' }, 400);
    }
    if (!['rotate', 'revoke', 'withdraw'].includes(action))
        return reply({ error: 'Invalid action' }, 400);
    const token = action === 'rotate' ? randomBytes(32).toString('hex') : null;
    try {
        const { data, error } = await createServiceClient().rpc('chalk_admin', { p_owner: user.id, p_action: action, p_key_hash: token ? digest(token) : null });
        if (error)
            return reply({ error: 'Calendar administration unavailable' }, 503);
        if (data.status !== 200)
            return reply({ error: 'Forbidden' }, 403);
        return reply({ ok: true, ...(token ? { token } : {}) });
    }
    catch {
        return reply({ error: 'Calendar administration unavailable' }, 503);
    }
}
