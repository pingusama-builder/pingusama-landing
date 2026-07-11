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
| 7 | companion-tools.ts | ✅ done | 3d49078 | deny-by-default allowlist + pure propose_edit + save_writing_preference + set_model delegate. 1 test bug fixed (see deviations) |
| 8 | chat scoping (chat route + actions) | ✅ done | a78dcfc | route 400s on purpose!=chat; getThreadAction→getChatThread. Checkpoint: full suite 271 pass + tsc clean. 1 latent test-mock fix (see deviations) |
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
5. **T7 test — missing `await` on sync dispatch tests**: plan's three "refuses X" tests call `executeCompanionToolCall(...)` WITHOUT `await` even though it's `async` (returns a Promise), so `r.content` was undefined → `.toMatch()` threw "expects a string, got undefined". **Fix:** make those three `it` callbacks `async` and `await` the call. The async tests (routes propose_edit, set_model, save_writing_preference) were already correct. (companion-tools.test.ts)
6. **T8 checkpoint — latent `chat-memory.test.ts` mock missed in T2**: running `npx tsc --noEmit` at the Task 8 checkpoint surfaced `chat-memory.test.ts:410` — the `baseThread` ChatThread factory omitted the three discriminator fields added in Task 2 (`purpose/subject_type/subject_key`), so its returned object had `purpose?: string | undefined` not `purpose: string`. Latent since T2 (tsc wasn't run on tests until now; `npm run build` / next build doesn't typecheck test files, so the build stayed green). **Fix:** add `purpose: "chat"`, `subject_type: null`, `subject_key: null` to the factory (one fix covers all derived mocks in the file). Bundled into the T8 commit. Not a plan-spec deviation — a missed test fixture from T2. (chat-memory.test.ts)

## RESUME HERE

**Current in-flight task: Task 9 (companion route — /api/blog-companion, SSE, admin-gated, origin-checked).** No work started yet on Task 9. Tasks 1–8 done. Checkpoint after T8: full suite **271 pass / 21 files**, `npx tsc --noEmit` clean (a latent T2 test-mock fix was applied + logged as deviation #6). HEAD = a78dcfc.

Task 9 is LARGE (plan lines 2490–3828). Read that whole section from disk before starting — it has the full `companion-route.test.ts` (mirrors chat-route.test.ts: authMock/chatMock/writingContextMock/mistralMock + drainSSE/makeRequest helpers) and the full `app/api/blog-companion/route.ts` implementation.

Creates 2 files:
- `my-app/app/api/blog-companion/route.ts` — `POST(request): Promise<Response>` SSE stream of `{thread|model|content|proposal|tool|error|done}`. Admin gate + same-origin check; request + size limits; server-authoritative thread resolution by subject (`getCompanionThread`/`getOrCreateCompanionThread`) + per-turn verification; scope-based model routing (`scopeToTier` helper, module-local); persists the REQUEST only (not the draft); MAX_TURNS=3; deny-by-default dispatch (Task 7 allowlist) is the security boundary; `request.signal` propagated to `mistralStream`. Imports NO site-write module + NO generic service client (verified by static-dep test in T14).
- `my-app/tests/unit/companion-route.test.ts` — new, mirrors chat-route.test.ts.

Consumes (all exist): `getCurrentUser`/`isAdmin` (@/lib/auth); `getCompanionThread`/`getOrCreateCompanionThread`/`appendMessage`/`getMessages`/`consumeOneTurnOverride`/`recallMemories`/`MessageRole`/`ChatMessageRow` (@/lib/db/chat); `buildWritingContext` (@/lib/chat/writing-context); `buildCompanionPrompt` (@/lib/chat/companion-prompt); `COMPANION_TOOLS`/`executeCompanionToolCall`/`CompanionDraft` (@/lib/chat/companion-tools); `MODEL_TIERS`/`DEFAULT_TIER`/`ModelTier`/`ModelPreference` (@/lib/chat/models); `mistralStream`/`MistralMessage`/`MistralToolCall` (@/lib/chat/mistral); `DraftSnapshot` (@/lib/blog/proposals).

Next actions, in order:
1. Read plan §Task 9 from disk (lines 2490–3828) — the whole thing, it's large.
2. Write `tests/unit/companion-route.test.ts` (failing test first).
3. `cd my-app && npx vitest run tests/unit/companion-route.test.ts` → expect import failure (route missing).
4. Write `app/api/blog-companion/route.ts`.
5. Re-run → expect pass. If a plan test/impl mismatch appears, fix minimally and **log it in `## Deviations from plan`** above (append a numbered item). Watch for the same kinds of bugs seen before (push() arg shape, missing await on async dispatch, regex for bold, fixture counts).
6. Commit Task 9: `git add my-app/app/api/blog-companion/route.ts my-app/tests/unit/companion-route.test.ts && git commit -m "feat(blog-companion): /api/blog-companion SSE route — admin-gated, origin-checked, deny-by-default"`; capture SHA.
7. Cadence: mark T9 ✅ + SHA in table; rewrite RESUME HERE → Task 10 (lines 3829–4020); `git commit -m "docs(blog): execution progress — Task 9 done"`; append HANDOFF one-liner. **Task 9 is a LARGE checkpoint boundary** — run the full suite + tsc after, extra-careful progress + HANDOFF commits.

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