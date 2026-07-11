"use server";

import { requireAdmin } from "@/lib/auth";
import {
  listThreads,
  getThread,
  getMessages,
  listAllMemories,
  setMemoryActive,
  updateMemoryContent,
  setThreadModelPreference,
  type MemoryType,
  type ChatThread,
  type ChatMessageRow,
  type MemoryRow,
} from "@/lib/db/chat";
import { refreshAwareness, type SiteCategory } from "@/lib/chat/awareness";
import { MODEL_PREFERENCES, type ModelPreference } from "@/lib/chat/models";

export interface ThreadSummary {
  id: string;
  title: string;
  updated_at: string;
  messageCount: number;
}

export async function listThreadsAction(): Promise<ThreadSummary[]> {
  await requireAdmin();
  const threads = await listThreads(50);
  // Cheap counts: one query per thread is fine for a personal admin tool.
  const out: ThreadSummary[] = [];
  for (const t of threads) {
    const msgs = await getMessages(t.id);
    out.push({
      id: t.id,
      title: t.title,
      updated_at: t.updated_at,
      messageCount: msgs.length,
    });
  }
  return out;
}

export async function getThreadAction(threadId: string): Promise<{
  thread: ChatThread | null;
  messages: ChatMessageRow[];
}> {
  await requireAdmin();
  const [thread, messages] = await Promise.all([getThread(threadId), getMessages(threadId)]);
  return { thread, messages };
}

export async function listMemoriesAction(opts: {
  type?: MemoryType;
  activeOnly?: boolean;
} = {}): Promise<MemoryRow[]> {
  await requireAdmin();
  return listAllMemories(opts);
}

export async function setMemoryActiveAction(
  id: string,
  active: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    await setMemoryActive(id, active);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function updateMemoryContentAction(
  id: string,
  patch: { content?: string; description?: string }
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    await updateMemoryContent(id, patch);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function refreshAwarenessAction(
  category?: SiteCategory
): Promise<{ success: true; results: Awaited<ReturnType<typeof refreshAwareness>> } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const results = await refreshAwareness({ category });
    return { success: true, results };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function setThreadModelPreferenceAction(
  threadId: string,
  preference: ModelPreference
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    if (!MODEL_PREFERENCES.includes(preference)) {
      return { success: false, error: `Invalid model preference: ${preference}` };
    }
    await setThreadModelPreference(threadId, preference);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}