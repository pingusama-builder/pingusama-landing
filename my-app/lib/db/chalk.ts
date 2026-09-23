import { createServiceClient } from '@/lib/supabase/server';
import type { CalendarRepository, StoredCalendar } from '@/lib/chalk-sync';
export const calendarRepository: CalendarRepository = {
    async read() { const { data, error } = await createServiceClient().from('chalk_calendar').select('published,payload,accepted_at').eq('id', 1).maybeSingle(); if (error)
        throw error; return data as StoredCalendar | null; },
    async publish(keyHash, payload, payloadHash) { const { data, error } = await createServiceClient().rpc('chalk_publish', { p_key_hash: keyHash, p_snapshot: payload, p_payload_hash: payloadHash }); if (error)
        throw error; return data; }
};
