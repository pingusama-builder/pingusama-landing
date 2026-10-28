import { createServiceClient } from '@/lib/supabase/server';
import type { ThreadsaveRepository } from '@/lib/threadsave-sync';

export const threadsaveRepository: ThreadsaveRepository = {
  async read(owner) {
    const { data, error } = await createServiceClient().from('threadsave_archive').select('payload,accepted_at').eq('id', 1).eq('owner_id', owner).maybeSingle();
    if (error) throw error;
    return data;
  },
  async publish(keyHash, payload, payloadHash) {
    const { data, error } = await createServiceClient().rpc('threadsave_publish', { p_key_hash: keyHash, p_snapshot: payload, p_payload_hash: payloadHash });
    if (error) throw error;
    return data;
  },
  async admin(owner, action, keyHash) {
    const { data, error } = await createServiceClient().rpc('threadsave_admin', { p_owner: owner, p_action: action, p_key_hash: keyHash });
    if (error) throw error;
    return data;
  },
};
