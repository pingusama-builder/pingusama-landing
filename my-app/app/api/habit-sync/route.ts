import { makeHandlers } from '@/lib/chalk-sync';
import { calendarRepository } from '@/lib/db/chalk';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlers = makeHandlers(calendarRepository);
export const GET = handlers.GET;
export const POST = handlers.POST;
