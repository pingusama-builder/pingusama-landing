# Blog Writing Companion — Execution Progress

> Single source of in-flight state. Survives compaction (it's on disk + committed).
> **Resume protocol:** (1) read this file, (2) `git log --oneline -15`, (3) read the *current task's* section from the plan file, (4) continue from `## RESUME HERE`.
>
> **Plan file (spec, read per-task):** `docs/superpowers/plans/2026-07-11-blog-writing-companion.md`
> **Spec (source of truth):** `docs/superpowers/specs/2026-07-11-blog-writing-companion-design.md`
> **Branch:** `feat/blog-companion` (base master @ 0021285). **DO NOT deploy or merge.**

## Build-order note (important — already burned me once)

The plan *numbers* tasks 1–14 but the **build order** must satisfy import deps:
- **Task 6 (`lib/blog/proposals.ts`) before Task 5** — `companion-prompt.ts` imports `DraftSnapshot` from it.
- **Task 6 before Task 7** — `companion-tools.ts` imports its types.
- Otherwise numerical order: 1, 2, 3, 4, **6, 5**, 7, 8, 9, 10, 11, 12, 13, 14.

## Task table

| # | Task | Status | Commit | Notes |
|---|------|--------|--------|-------|
| 1 | Shared memory-write cap (tools.ts) | ✅ done | 21a1fe9 | update_memory + delete_memory now check+increment cap |
| 2 | Discriminated-thread schema | ✅ done | 826719d | appended to supabase/schema-chat.sql + lib/db/schema.sql §10b |
| 3 | Thread helpers + writing- guard (db/chat.ts) | ✅ done | a8295e5 | ChatThread +purpose/subject; getChatThread/getCompanionThread/getOrCreateCompanionThread/listChatThreads/listIdleChatThreads; assertWritingPrefName; listThreads+listIdleUnprocessedThreads re-scoped to purpose='chat'. 2 plan bugs fixed (see deviations) |
| 4 | buildWritingContext | ✅ done | b19b6f5 | lib/chat/writing-context.ts; dropped unused MemoryRow import |
| 6 | Pure proposal logic (lib/blog/proposals.ts) | ✅ done | 88bec8b | built BEFORE Task 5. 1 plan test bug fixed (see deviations) |
| 5 | buildCompanionPrompt | ✅ done | 9d602e0 | built AFTER T6; companion-prompt.ts + test (13 pass); hierarchy regex fixed (deviation #4) |
| 7 | companion-tools.ts | ⬜ pending | — | imports proposals (T6) + tools + chat |
| 8 | chat scoping (chat route + actions) | ⬜ pending | — | route rejects purpose!=chat; getThreadAction→getChatThread; listThreadsAction/inferIdleThreadsAction already chat-scoped via T3 |
| 9 | /api/blog-companion route + route test | ⬜ pending | — | LARGE — SSE route + companion-route.test.ts |
| 10 | BlogCompanion.tsx + UI test | ⬜ pending | — | LARGE — static-grep UI test |
| 11 | PostEditor integration + test | ⬜ pending | — | static-grep integration test |
| 12 | Companion CSS + test | ⬜ pending | — | append .companion* to globals.css; static-grep css test |
| 13 | XSS publish-boundary + eval corpus | ⬜ pending | — | xss-publish.test.ts + companion-eval.test.ts + fixtures |
| 14 | static-deps test + verify + HANDOFF | ⬜ pending | — | companion-static-deps.test.ts; npm test / tsc / build; final HANDOFF section |

Baseline before branch: 198 tests. After T1–T6: 219 + 19 (blog-proposals) + ... (running total updated each task).

## Deviations from plan (do NOT re-fix these on resume)

1. **T3 impl — `assertWritingPrefName`**: plan only checked `site:` + `writing-` prefix. Test "writing-Bad Name" expects kebab rejection. **Fix:** also call `isValidName(name)` → throw on invalid kebab. (lib/db/chat.ts)
2. **T3 test — race `push()` arg**: plan wrote `f.push({ data: null, error: {...} })` but `push(data, error)` is two-arg → object became `data`, `error` defaulted null → `insErr` falsy. **Fix:** `f.push(null, { message: "duplicate key value violates unique constraint" })`. (companion-threads.test.ts)
3. **T6 test — `draft` fixture**: plan had `"# Title\n\nThe opening repeats the title. The opening repeats the title."` (phrase **twice**) + `bodyProposal` range `{0, len}` (wrong — occurrence is at index 9). Server enforces `original` occurs exactly once, so an apply-test draft must have it once. **Fix:** `draft.content_markdown = "# Title\n\nThe opening repeats the title. Some other line."` (phrase once) and `bodyProposal` range = `{ start: 9, end: 9 + original.length }`. (blog-proposals.test.ts)
4. **T5 test — hierarchy regex**: plan regexes `/N\.\s*Phrase/` don't match `N. **Phrase**` (markdown bold `**` between number and text). **Fix:** `/N\.\s*\**Phrase/` (allow the `*` chars) for all 5 levels. (companion-prompt.test.ts)

## RESUME HERE

**Current in-flight task: Task 7 (companion-tools.ts).** No work started yet on Task 7.

Read plan lines ~1671–2210 (`## Task 7: Companion tools`). Task 7 creates `lib/chat/companion-tools.ts` + `tests/unit/companion-tools.test.ts`. It imports from `@/lib/chat/tools` (executeToolCall/ToolContext/ToolResult), `@/lib/db/chat` (saveMemory/assertMemoryInput/assertWritingPrefName/MemoryType), `@/lib/blog/proposals` (draftRevision/findOccurrences/types — all exist from T6), `@/lib/chat/mistral` (MistralTool type), `node:crypto`. Produces COMPANION_TOOLS, COMPANION_ALLOWED, CompanionDraft, CompanionToolResult, executeProposal, executeSaveWritingPreference, executeCompanionToolCall.

Next actions, in order:
1. Read plan §Task 7 from disk (`docs/superpowers/plans/2026-07-11-blog-writing-companion.md`).
2. Write `tests/unit/companion-tools.test.ts` (failing test first).
3. `npx vitest run tests/unit/companion-tools.test.ts` → expect import failure (module missing).
4. Write `lib/chat/companion-tools.ts`.
5. Re-run → expect pass. If a plan test/impl mismatch appears, fix minimally and **log it in `## Deviations from plan`** above (append a numbered item).
6. Commit Task 7: `git add my-app/lib/chat/companion-tools.ts my-app/tests/unit/companion-tools.test.ts && git commit -m "feat(chat): companion tools — deny-by-default allowlist + propose_edit + save_writing_preference"`; capture SHA.
7. Cadence: mark T7 ✅ + SHA in table; rewrite RESUME HERE → Task 8; `git add docs/.../progress/...md && git commit -m "docs(blog): execution progress — Task 7 done"`; append HANDOFF one-liner + commit.

## After every task (cadence)

- Mark the task ✅ + commit SHA in the table above.
- Rewrite `## RESUME HERE` to the next task (note the plan line range to read).
- Commit the progress file: `git commit -m "docs(blog): execution progress — Task N done"`.
- Append a one-line status to HANDOFF.md + commit it.
- Run the task's tests (and at Task 14: full `npm test` + `npx tsc --noEmit` + `npm run build`).

## Checkpoint boundaries (extra-careful progress + HANDOFF commits)

After Tasks **8, 10, 12, 14** — the big tasks (9, 10) get a clean boundary right after them so a compaction inside them loses ≤ the in-flight task.

## Next-session starter prompt (copy into a fresh session)

```
Continue the Pingusama's Tinkering blog writing companion build at D:\claude projects\Pingusama's Repositories\pingusama-site-mockup-wheel. It is being built task-by-task on branch feat/blog-companion (base master @ 0021285) per the plan at docs/superpowers/plans/2026-07-11-blog-writing-companion.md (spec: docs/superpowers/specs/2026-07-11-blog-writing-companion-design.md). DO NOT deploy or merge. RESUME PROTOCOL: (1) read docs/superpowers/progress/2026-07-11-blog-writing-companion.md FIRST, (2) git log --oneline -15, (3) read the current task's section from the plan file, (4) continue from the progress file's ## RESUME HERE. Do NOT re-apply fixes listed in the progress file's Deviations section. Build order note: Task 6 was built before Task 5 (import deps). Two product principles are load-bearing: writer's originality paramount (willing to recommend NO change) + no sugar-coating. Security boundary is code-architecture (no site-write import in companion path; deny-by-default allowlist; runtime-validated SSE; constrained write tool) — verify with tests, don't rebuild; publish path is already XSS-sanitized (parseMarkdown + rehypeSanitize). Keep Fraunces/Nunito tokens; verify mobile at 390px. The Supabase token is authed for prod kuyytbmmvxcmiyxqsnpe — re-login via `npx supabase login --token <token>` if Unauthorized.
```