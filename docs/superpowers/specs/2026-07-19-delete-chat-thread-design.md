# Delete chat thread — design

**Date:** 2026-07-19
**Branch:** `feat/delete-chat-thread` (off master `facc515`)
**Status:** design — awaiting implementation plan

## Goal

Add an admin-only way to delete a chat conversation thread from `/admin/chat`.
Motivated by the Spider-Man smoke-test thread that should be cleared, and
needed generally as a basic thread-management primitive the companion lacked.

## Why now

The round-3 live admin smoke left a Spider-Man thread in the admin thread list.
There is no delete affordance anywhere in the companion. A delete-thread
function is needed both to clear test threads and as ongoing hygiene.

## Non-goals (out of scope)

- Delete in the MemoriesManager thread list (that list is for inference, not
  browsing — adding delete there is scope creep).
- Bulk delete.
- Soft-delete / undo / archive.
- Any UI for deleting blog-companion threads (those are keyed to a post/draft
  and managed by `getOrCreateCompanionThread`; this feature is chat-only).

## Data model (already in place — no migration)

From `my-app/lib/db/schema.sql`:

- `chat_messages.thread_id` → `chat_threads(id)` `ON DELETE CASCADE` — deleting
  a thread automatically removes its messages.
- `chat_memories.source_thread_id` → `chat_threads(id)` `ON DELETE SET NULL` —
  memories are global (not per-thread); deleting a thread nulls their
  provenance link but keeps the memories.
- `chat_threads.purpose` CHECK (`'chat' | 'blog-companion'`). `getChatThread(id)`
  returns `null` unless `purpose = 'chat'` — a reusable chat-only guard.

Both constraints are already applied to prod (`kuyytbmmvxcmiyxqsnpe`), verified
during the debug-log capture arc. **No Supabase migration this round.**

## User decision captured

When a thread is deleted, the user chose **"offer both, decide per-delete"**:
the confirm dialog includes a choice of whether to also delete the memories
sourced from that thread. Default is to keep memories (they are the durable
value of the companion); the per-delete choice lets the user wipe the
sourced memories too when desired.

## Design

### Behavior

- In the `/admin/chat` thread sidebar, each thread row gains a small delete
  (trash) button.
- Clicking it opens a **confirm modal** (not the browser `confirm()` — it cannot
  express the per-delete memory choice). The modal mirrors `BenchOverlay.tsx`'s
  accessibility pattern: `role="dialog"`, `aria-modal="true"`, focus-trap,
  Escape to close, backdrop-click to close, body-scroll lock.
- Modal content:
  - Thread title.
  - "N messages will be deleted."
  - A checkbox "Also delete M memories sourced from this conversation" — shown
    only when `M > 0`. Default unchecked (keep memories).
  - `[Cancel]` and `[Delete thread]` (destructive-styled).
- `[Delete thread]` is disabled while the request is in flight; the trash
  button is disabled while a thread is streaming (matches the existing
  `disabled={streaming}` pattern on thread buttons).
- On success: refresh the thread list via `listThreadsAction`; if the deleted
  thread was the active thread, clear `activeId` + `messages` (return to the
  empty state); close the modal.
- On failure: surface the error in the existing chat error surface, keep the
  modal open so the user can retry or cancel.

### `ThreadSummary` extension

`ThreadSummary` gains `sourcedMemoryCount: number`. `listThreadsAction` adds
one count query per thread (`chat_memories` where `source_thread_id = t.id`).
This is consistent with the existing one-count-query-per-thread pattern for
`messageCount` (the code comment already calls this "cheap for a personal admin
tool"). It lets the modal show the memory count without an extra round-trip.

### Layer 1 — DB (`lib/db/chat.ts`, new pure DB functions)

- `deleteThread(id): Promise<{ deleted: boolean }>` — chat-only-guarded hard
  delete. Calls `getChatThread(id)` first; if it returns `null` (unknown or
  `purpose = 'blog-companion'`), returns `{ deleted: false }` and deletes
  nothing. Otherwise `DELETE FROM chat_threads WHERE id = ?`. Cascade removes
  messages; memory `source_thread_id` is SET NULL by the existing constraint.
- `deleteMemoriesSourcedFromThread(threadId): Promise<number>` —
  `DELETE FROM chat_memories WHERE source_thread_id = ?`, returns the count.
- `countMemoriesSourcedFromThread(threadId): Promise<number>` — count for the
  list. (Or fold into `listThreadsAction`'s per-thread query — implementation
  choice; either is acceptable.)

### Layer 2 — server action (`app/admin/chat/actions.ts`)

New action mirroring the existing return shape:

```ts
export async function deleteThreadAction(
  threadId: string,
  opts: { alsoDeleteMemories: boolean }
): Promise<
  | { success: true; memoriesDeleted: number }
  | { success: false; error: string }
>
```

Flow: `requireAdmin()` → `getChatThread(threadId)` (null → `{ success: false,
error: "Thread not found or not a chat thread" }`) → if `alsoDeleteMemories`,
call `deleteMemoriesSourcedFromThread` first and capture the count →
`deleteThread` → return `{ success: true, memoriesDeleted }`.

**Ordering invariant:** delete the sourced memories **before** the thread.
`source_thread_id` is SET NULL on thread deletion, so after the thread is gone
the memories can no longer be found by `source_thread_id`. The action must
delete memories first, then the thread. A test pins this ordering.

Also: `listThreadsAction` is updated to populate `sourcedMemoryCount`.

### Layer 3 — UI (`components/ChatUI.tsx`)

- Trash button per thread row in the sidebar. At 390px the sidebar is narrow;
  keep it compact and ensure a tappable ≥44px target (per the mobile-first
  rule). Exact placement (inline on the row vs revealed on hover/active) is an
  implementation choice; the constraint is that it works at 390px and is
  reachable while a thread is not streaming.
- Confirm modal with local state: `deleteTarget: ThreadSummary | null`,
`alsoDeleteMemories: boolean`, `pending: boolean`.
- Post-success: `setThreads(await listThreadsAction())`; if `deleteTarget.id ===
  activeId`, clear `activeId` and `messages`; close the modal.

### CSS (`app/globals.css`)

Add styles for the trash button + confirm modal. Reuse existing `chat-*` and
`bench-overlay` token classes; Fraunces/Nunito tokens; walnut/terracotta for
the destructive button. No new design tokens.

## Security

- **Admin-only:** `requireAdmin()` (same as every chat action).
- **Chat-only guard:** `getChatThread` returns `null` for `purpose =
  'blog-companion'`, so a companion thread can never be deleted by ID. The
  action refuses unknown/non-chat ids with a clear error.
- **No site writes:** the action deletes only chat data (`chat_threads`,
  `chat_messages` via cascade, optional `chat_memories`). It never touches
  posts/shelf/vault/blog. The action imports only `lib/db/chat` — no
  `@/app/admin/blog/actions`, no `@/lib/supabase/server`, no site-write
  identifier. No `dangerouslySetInnerHTML` (plain modal markup, no
  user-supplied HTML rendered).
- **Static guard:** `chat-web-static-deps.test.ts` already includes
  `actions.ts` in its files map (the no-site-write-imports sweep). A new
  assertion will pin that `deleteThreadAction`'s body references only chat DB
  functions and no site-write identifier — guarding against a future edit that
  reaches across the boundary.

## Testing

- **DB layer** (`lib/db/chat.ts`): mock the service client (match existing
  `chat-db` test conventions). Cases: `deleteThread` cascades (the `.delete()`
  is issued on the right table, chat-only guard refuses companion/unknown id),
  `deleteMemoriesSourcedFromThread` issues the right delete + returns count,
  `countMemoriesSourcedFromThread` returns the count.
- **Action** (`chat-actions` tests): admin gate (non-admin throws), chat-only
  guard (companion id → `{success:false, error}`), missing thread → error,
  `alsoDeleteMemories: true` deletes memories and returns the count,
  `alsoDeleteMemories: false` issues no memory delete and returns 0, ordering
  (memories deleted before thread — assert call order), `listThreadsAction`
  populates `sourcedMemoryCount`.
- **UI** (`ChatUI`): modal opens on trash click, closes on Cancel/Escape/backdrop,
  checkbox shown only when `sourcedMemoryCount > 0`, post-delete clears the
  active thread when it was the one deleted, error keeps the modal open. Match
  existing `chat-route`/UI test conventions.
- **Mobile-first:** manually verify the modal + trash button at 390px (tappable
  target, no horizontal overflow, modal scrolls if tall) per the project rule.
- **Full suite:** `npm test`, `npx tsc --noEmit`, `npm run build` all green.

## Deploy notes

- **No migration** this round (cascade + SET NULL already in prod).
- Standing rule: **no merge / no deploy without the user's explicit go-ahead.**
- When approved: merge `--ff-only` to master, deploy from REPO ROOT via
  `vercel --prod --yes --scope thegrandpingu-9836s-projects`, push origin. Anon
  smoke (GET / 200, `/api/me` admin:false, `POST /api/chat` 401) + an admin
  delete-thread smoke (delete the Spider-Man thread, confirm it leaves the
  list, confirm a sourced-memory delete round-trips).

## Open questions for implementation

None blocking. The placement of the trash button (inline vs revealed) and
whether to fold the count query into `listThreadsAction` are implementation
choices left to the plan.