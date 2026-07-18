"use server";

import { requireAdmin } from "@/lib/auth";
import {
  listThreads,
  getChatThread,
  getMessages,
  listAllMemories,
  setMemoryActive,
  updateMemoryContent,
  setThreadModelPreference,
  listIdleUnprocessedThreads,
  type MemoryType,
  type ChatThread,
  type ChatMessageRow,
  type MemoryRow,
  type CompanionDebugLog,
} from "@/lib/db/chat";
import { refreshAwareness, type SiteCategory } from "@/lib/chat/awareness";
import { MODEL_PREFERENCES, type ModelPreference } from "@/lib/chat/models";
import { inferMemoriesFromThread, type InferenceSummary } from "@/lib/chat/infer";

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
  // Chat UI only: a companion-purpose thread returns null so the UI never
  // renders one (companion threads don't appear in listThreadsAction either).
  const [thread, messages] = await Promise.all([getChatThread(threadId), getMessages(threadId)]);
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

export async function inferFromThreadAction(
  threadId: string,
  opts?: { forceFull?: boolean }
): Promise<{ success: true; summary: InferenceSummary } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const summary = await inferMemoriesFromThread(threadId, opts);
    return { success: true, summary };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Inference failed" };
  }
}

export async function inferIdleThreadsAction(): Promise<
  { success: true; summaries: InferenceSummary[] } | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const idle = await listIdleUnprocessedThreads({ idleMinutes: 15, limit: 2 });
    const summaries: InferenceSummary[] = [];
    for (const t of idle) {
      try {
        summaries.push(await inferMemoriesFromThread(t.id));
      } catch {
        // one thread failing must not abort the rest
      }
    }
    return { success: true, summaries };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Inference failed" };
  }
}

export async function getThreadDebugLogAction(
  threadId: string
): Promise<{ success: true; log: CompanionDebugLog } | { success: false; error: string }> {
  try {
    await requireAdmin();
    // Chat UI only — getChatThread returns null for companion-purpose or unknown threads.
    const thread = await getChatThread(threadId);
    if (!thread) {
      return { success: false, error: "Thread not found or not a chat thread" };
    }
    const messages = await getMessages(threadId);
    return {
      success: true,
      log: {
        thread: {
          id: thread.id,
          title: thread.title,
          created_at: thread.created_at,
          updated_at: thread.updated_at,
          model_preference: thread.model_preference,
        },
        exportedAt: new Date().toISOString(),
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          created_at: m.created_at,
          model: m.model,
          tool_calls: m.tool_calls,
          reasoning: m.reasoning,
          telemetry: m.telemetry,
          web_research: m.web_research,
        })),
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
