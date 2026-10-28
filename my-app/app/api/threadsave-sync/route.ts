import { getCurrentUser, isAdmin } from '@/lib/auth';
import { makeHandlers } from '@/lib/threadsave-sync';
import { threadsaveRepository } from '@/lib/db/threadsave';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlers = makeHandlers(threadsaveRepository, async () => {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user.id : null;
});
export const GET = handlers.GET;
export const POST = handlers.POST;
