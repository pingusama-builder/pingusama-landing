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
| 11 | PostEditor integration + test | ✅ done | ba41910 | static-grep integration test (5 tests) + 4 PostEditor edits. Full suite 304 pass + tsc clean. 1 impl fix (see deviations) |
| 12 | Companion CSS + test | ✅ done | 2036549 | append .companion* to globals.css; static-grep css test (6 tests). Checkpoint: full suite 310 pass. 1 token fix (see deviations) |
| 13 | XSS publish-boundary + eval corpus | ✅ done | e7b1d02 | verification task — 17 new tests (11 XSS payloads + 2 propose_edit→render + 1 no-dangerouslySetInnerHTML + 3 eval corpus). Existing parseMarkdown boundary CONFIRMED; no impl change. No deviation |
| 14 | static-deps test + verify + HANDOFF | ✅ done | d864c4d | companion-static-deps.test.ts (8 tests). FINAL checkpoint: npm test 335/335 pass (28 files), tsc clean, build green (/api/blog-companion route present). HANDOFF "BUILT" section written on disk. 1 test-side fix (deviation #10: stripComments for FORBIDDEN_IDENTIFIERS guard) |

Baseline before branch: 198 tests. After T1–T6: 219 + 19 (blog-proposals) + ... (running total updated each task).

## Deviations from plan (do NOT re-fix these on resume)

1. **T3 impl — `assertWritingPrefName`**: plan only checked `site:` + `writing-` prefix. Test "writing-Bad Name" expects kebab rejection. **Fix:** also call `isValidName(name)` → throw on invalid kebab. (lib/db/chat.ts)
2. **T3 test — race `push()` arg**: plan wrote `f.push({ data: null, error: {...} })` but `push(data, error)` is two-arg → object became `data`, `error` defaulted null → `insErr` falsy. **Fix:** `f.push(null, { message: "duplicate key value violates unique constraint" })`. (companion-threads.test.ts)
3. **T6 test — `draft` fixture**: plan had `"# Title\n\nThe opening repeats the title. The opening repeats the title."` (phrase **twice**) + `bodyProposal` range `{0, len}` (wrong — occurrence is at index 9). Server enforces `original` occurs exactly once, so an apply-test draft must have it once. **Fix:** `draft.content_markdown = "# Title\n\nThe opening repeats the title. Some other line."` (phrase once) and `bodyProposal` range = `{ start: 9, end: 9 + original.length }`. (blog-proposals.test.ts)
4. **T5 test — hierarchy regex**: plan regexes `/N\.\s*Phrase/` don't match `N. **Phrase**` (markdown bold `**` between number and text). **Fix:** `/N\.\s*\**Phrase/` (allow the `*` chars) for all 5 levels. (companion-prompt.test.ts)
5. **T7 test — missing `await` on sync dispatch tests**: plan's three "refuses X" tests call `executeCompanionToolCall(...)` WITHOUT `await` even though it's `async` (returns a Promise), so `r.content` was undefined → `.toMatch()` threw "expects a string, got undefined". **Fix:** make those three `it` callbacks `async` and `await` the call. The async tests (routes propose_edit, set_model, save_writing_preference) were already correct. (companion-tools.test.ts)
6. **T8 checkpoint — latent `chat-memory.test.ts` mock missed in T2**: running `npx tsc --noEmit` at the Task 8 checkpoint surfaced `chat-memory.test.ts:410` — the `baseThread` ChatThread factory omitted the three discriminator fields added in Task 2 (`purpose/subject_type/subject_key`), so its returned object had `purpose?: string | undefined` not `purpose: string`. Latent since T2 (tsc wasn't run on tests until now; `npm run build` / next build doesn't typecheck test files, so the build stayed green). **Fix:** add `purpose: "chat"`, `subject_type: null`, `subject_key: null` to the factory (one fix covers all derived mocks in the file). Bundled into the T8 commit. Not a plan-spec deviation — a missed test fixture from T2. (chat-memory.test.ts)
7. **T9 test — proposal `range.start` index off by the heading prefix**: the proposal-event test's DRAFT was `content_markdown: "# Draft\n\nThe opening repeats the title."` and asserted `range.start === 0`, but the `# Draft\n\n` prefix is 9 chars so the phrase occurs at index 9 (the server-computed range is correct; the assertion was wrong). Same class of fixture/index bug as deviation #3 (T6). The plan's intent was the phrase at index 0. **Fix:** drop the heading prefix — `content_markdown: "The opening repeats the title."` — so the phrase sits at index 0 and `range.start === 0` holds. No other test depends on the draft body content. (companion-route.test.ts)
8. **T11 impl — optional form fields not coalesced for DraftSnapshot**: `PostFormData` (in `app/admin/blog/actions.ts`) types `excerpt` and `meta_description` as optional (`string | undefined`), but `DraftSnapshot` (in `lib/blog/proposals.ts`) requires them as `string`. The plan's `applyProposal` (`current`) and `draftSnapshot` constructions passed `form.excerpt`/`form.meta_description` raw → tsc error "Type 'string | undefined' is not assignable to type 'string'" at the two constructions (4 lines). The companion route already coalesces `draft.excerpt ?? ""` for the same reason (route.ts:148-149). **Fix:** `excerpt: form.excerpt ?? "",` and `meta_description: form.meta_description ?? "",` in both constructions. `content_markdown`/`title` are required in PostFormData so they need no coalesce. (PostEditor.tsx)
9. **T12 CSS — `--paper` token referenced but not defined**: the plan's Task 12 Interfaces section lists `--paper` as an existing token and the CSS block uses `color: var(--paper)` for the Apply + Send buttons (light text on dark `--walnut`/`--terracotta` backgrounds), but `--paper` was NOT in the `:root` token set (only `--bg`/`--bg-card`/`--bg-card-hi`). An undefined var would leave the button text color unset → poor contrast. The companion-css test does not assert `--paper` so this was a latent quality bug, not a test failure. **Fix:** add `--paper: #FAF3E0;` to `:root` (the lightest existing value, same as `--bg-card-hi`) — additive, matches the plan's stated token set, no other rule references `--paper` so nothing else changes. (globals.css)
10. **T14 test — `FORBIDDEN_IDENTIFIERS` guard false-positives on a security-doc comment**: the plan's static-deps test does `expect(f).not.toContain(id)` on the raw source for `savePostAction|createPost|updatePost|deletePost|deletePostAction`. But `route.ts:31-38` has a SECURITY header comment that deliberately names those exact functions ("It does NOT import savePostAction / createPost / updatePost / deletePost …") to document the boundary — so the naive `.not.toContain` flagged it. Same class as the comment false-positives the plan-deviation guidance anticipated. **Fix:** add a `stripComments()` helper (strips `/* */` block + `//` line comments) and run the identifier check on the comment-stripped code; `FORBIDDEN_IMPORTS` stays on the raw source (those regexes require `from "…"` syntax, which the comment doesn't contain, so they don't false-positive). The guard now targets real code references (imports/calls/bindings), not documentation. A real `import { createPost }` or `createPost(...)` call is still caught. (companion-static-deps.test.ts)

## RESUME HERE

**ALL 14 TASKS DONE. The blog writing companion is BUILT on `feat/blog-companion` (base master @ 0021285), NOT deployed / NOT merged — awaiting user review + deploy.**

Final checkpoint (Task 14) is GREEN:
- `npm test` → **335 tests passing / 28 files** (baseline 198 → +137 across Tasks 1–14).
- `npx tsc --noEmit` → clean (exit 0).
- `npm run build` → green; `/api/blog-companion` route present + `/admin/blog/new` + `/admin/blog/edit/[slug]` render BlogCompanion.
- `tests/unit/companion-static-deps.test.ts` (8 tests) → green; confirms the companion path imports NO site-write module / NO generic service client / NO `dangerouslySetInnerHTML`, + the `COMPANION_ALLOWED` allowlist is correct.

HEAD = d864c4d. Commits this session (Tasks 7–14): 3d49078 (T7), a78dcfc (T8), 647dd67 (T9), b533b67 (T10), ba41910 (T11), 2036549 (T12), e7b1d02 (T13), d864c4d (T14). Plus per-task progress commits.

**10 deviations logged** (all test-side or minor token/impl fixes; none change the spec or security boundary): see `## Deviations from plan` above. The last (T14): the static-deps `FORBIDDEN_IDENTIFIERS` guard false-positived on `route.ts`'s SECURITY header comment (which names the forbidden fns to document the boundary); fixed via `stripComments()` so the guard targets code, not comments.

**HANDOFF.md** (gitignored, on disk) has the "Blog writing companion: BUILT (awaiting user review + deploy)" section with the deploy instructions + a copyable next-session prompt. HANDOFF is NOT committed (gitignored — per the user's instruction, edit on disk only).

**Nothing left to build.** The next action is the USER's: review the diff vs master, then deploy + merge + apply the additive schema migration per the HANDOFF BUILT section. DO NOT deploy or merge without explicit user confirmation (the standing constraint from the original resume prompt).

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