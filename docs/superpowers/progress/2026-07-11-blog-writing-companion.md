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
| 9 | /api/blog-companion route + route test | ✅ done | 647dd67 | LARGE — SSE route + companion-route.test.ts (21 tests). Checkpoint: full suite 292 pass + tsc clean. 1 test fixture fix (see deviations) |
| 10 | BlogCompanion.tsx + UI test | ✅ done | b533b67 | LARGE — static-grep UI test (7 tests). Checkpoint: full suite 299 pass + tsc clean. No deviation |
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
7. **T9 test — proposal `range.start` index off by the heading prefix**: the proposal-event test's DRAFT was `content_markdown: "# Draft\n\nThe opening repeats the title."` and asserted `range.start === 0`, but the `# Draft\n\n` prefix is 9 chars so the phrase occurs at index 9 (the server-computed range is correct; the assertion was wrong). Same class of fixture/index bug as deviation #3 (T6). The plan's intent was the phrase at index 0. **Fix:** drop the heading prefix — `content_markdown: "The opening repeats the title."` — so the phrase sits at index 0 and `range.start === 0` holds. No other test depends on the draft body content. (companion-route.test.ts)

## RESUME HERE

**Current in-flight task: Task 11 (integrate BlogCompanion into PostEditor).** No work started yet on Task 11. Tasks 1–10 done. Checkpoint after T10 (LARGE): full suite **299 pass / 23 files**, `npx tsc --noEmit` clean. HEAD = b533b67. No deviation on T10.

Task 11 (plan lines 3829–4020) modifies `my-app/components/PostEditor.tsx` + creates `my-app/tests/unit/posteditor-integration.test.ts` (static-grep).

Modifications to PostEditor.tsx (4 edits — read the current file first to find exact anchors):
- **3a.** Imports after `import PostBody from "./PostBody"`: add `import BlogCompanion from "./BlogCompanion"` + `applyProposalToForm, Proposal, DraftSnapshot, UndoTarget, ApplyResult` from `@/lib/blog/proposals`.
- **3b.** After the existing state declarations (`const [uploading, setUploading] = useState(false)` + `const fileInputRef = useRef<HTMLInputElement>(null)`): add companion state — stable subject key (`subjectKeyRef` = `post?.id ?? draft:${crypto.randomUUID()}`, generated once via ref), `subjectType`, `companionThreadId` state, `applyProposal(proposal)` (builds a DraftSnapshot from `form`, calls `applyProposalToForm`, merges `res.form` into `form` via `setForm` — mutates ONLY form, never `savePostAction`), `undoProposal(undo)` (restores prev field value).
- **3c.** Change `return (` + opening `<form ...>` to wrap in a fragment: build `draftSnapshot` from `form`, `return ( <> <form ...>` (form body unchanged).
- **3d.** After the closing `</form>` (the one after the `{showPreview && ...}` block, before the final `)}`), insert `<BlogCompanion draft={draftSnapshot} subjectType={subjectType} subjectKey={subjectKeyRef.current!} threadId={companionThreadId} saveInProgress={isPending} onThreadReady={setCompanionThreadId} onApply={applyProposal} onUndo={undoProposal} />` + close the fragment `</> )}`.

Test asserts (static-grep): `<BlogCompanion` present; the spec prop names present; `applyProposalToForm`; `post.id|randomUUID|draft:`; `saveInProgress={isPending}`.

Consumes (all exist from T6/T10): `BlogCompanion`+`BlogCompanionProps` (@/components/BlogCompanion); `applyProposalToForm`/`Proposal`/`DraftSnapshot`/`UndoTarget`/`ApplyResult` (@/lib/blog/proposals). PostEditor already has `form`, `setForm`, `post`, `isPending` — verify those names exist in the current file before editing (the plan assumes them; if names differ, adapt + log a deviation).

Next actions, in order:
1. Read plan §Task 11 from disk (lines 3829–4020).
2. Read the current `components/PostEditor.tsx` to find the exact anchors (the `import PostBody` line, the state-declaration block, the `return (` + `<form`, the final `</form> )}` after `showPreview`). **Verify `form`/`setForm`/`post`/`isPending`/`showPreview`/`previewHtml`/`handleSubmit` exist with those names** — if any differ, adapt the plan's edits + log a deviation.
3. Write `tests/unit/posteditor-integration.test.ts` (failing test first).
4. `cd my-app && npx vitest run tests/unit/posteditor-integration.test.ts` → expect FAIL.
5. Apply the 4 edits to `PostEditor.tsx`.
6. `npx vitest run tests/unit/posteditor-integration.test.ts && npx tsc --noEmit` → expect PASS + tsc clean. If a plan test/impl mismatch appears, fix minimally and **log it in `## Deviations from plan`** above (append a numbered item).
7. Commit Task 11: `git add my-app/components/PostEditor.tsx my-app/tests/unit/posteditor-integration.test.ts && git commit -m "feat(blog): wire BlogCompanion into PostEditor — apply mutates form only, saveInProgress gates Apply"`; capture SHA.
8. Cadence: mark T11 ✅ + SHA in table; rewrite RESUME HERE → Task 12 (lines 4021–4340); `git commit -m "docs(blog): execution progress — Task 11 done"`; append HANDOFF one-liner. (Task 11 is not a checkpoint boundary, but the next one — Task 12 — is.)

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