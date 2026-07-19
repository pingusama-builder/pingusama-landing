# External-verification suggestion — design (delivery step 2)

Branch: `feat/external-verification-suggestion` (off master `7a3d1b6`).
Source verdict: `ai-advisor/debuglog-web-capture-01/VERDICT-phase7.md` (round-7
pivot). Reconcile: `VERDICT-phase7-reconcile.md` (AGREE in full).
**A.6 gate in force** — this doc is design only; no merge/deploy without explicit
user go-ahead. Nothing here is built yet.

This is delivery step 2 of the verdict's 8-step sequence: *design a turn/session
state model for pending source choice and resume behavior.* Step 1 (freeze the
B.2 branch) is done — `feat/external-sequence-direct-search-and-followup-routing`
has no unique commits (head == `7a3d1b6` == master); its working-tree harnesses
(`classifier-variance` / `classifier-substrate` / `boundary-oversearch`
`.live.test.ts`) + the additive `WEB_TRIGGER_SYSTEM` export are retained on this
new branch as detector fixtures.

---

## 0. What changes, in one paragraph

Today, one POST to `/api/chat` = one full turn: the route runs `decideWebEnabled`
(autonomous yes/no) and, if yes, runs the audited web pipeline then synthesizes.
After the pivot, an *auto* turn whose message the detector flags as "may benefit
from external verification" **does not synthesize** — it returns a *suggestion*
(a reason + the original subject) to the client, which renders an inline,
non-blocking choice (**[Search public sources] / [Stay on this site]**). The
user's click is a **second POST** (a *resume*) that resolves the choice: approve
→ run the existing audited web pipeline then synthesize; decline → site-first
synthesis with a scope label. Explicit `/web` and `/noweb` (and the legacy
`webEnabled`) still bypass detection entirely. The detector only *proposes*; it
never searches. Final browse/no-browse authority moves to the user.

## 1. The two-request turn model (the load-bearing piece)

An "external-verification" turn is **two POSTs**:

```
POST /api/chat  (message="which are the prerequisites for Kubernetes?")
  → detectExternalVerificationNeed(...) → { suggested: true, reason: "external-prerequisites", subject: "Kubernetes" }
  → appendMessage(user row)   [already happens today at route.ts:174]
  → insert pending_source_choices row  [NEW]
  → respond 200 { pendingChoice: { id, reason, subject } }   [no synthesis, no assistant row]

POST /api/chat  (sourceChoice="search", pendingChoiceId=<id>)
  → load + resolve the pending row  [NEW]
  → run the EXISTING audited web pipeline (rewrite→search→rank→read→evidence→synthesize)
  → appendMessage(assistant row with web_research audit + telemetry)
  → delete the pending row
  → stream the synthesized answer

POST /api/chat  (sourceChoice="stay", pendingChoiceId=<id>)
  → load + resolve the pending row
  → site-first synthesis (NO search, NO network call) with a scope label
  → appendMessage(assistant row, no web_research)
  → delete the pending row
  → stream the synthesized answer
```

Non-suggested auto turns and all explicit-web / explicit-no-web turns stay
**one POST** (unchanged from today, modulo the detection swap).

**Why two POSTs and not a held-open stream:** the serverless runtime is
stateless across requests; there is no held-open channel to wait on a human
click that takes arbitrary seconds. The pending choice must be **persisted**
between the two requests so the resume can find it. "Ephemeral to the
turn/session" (verdict) means *not a durable preference* — never memory, never
user context — NOT "not stored." It is stored turn-scoped and consumed on
resume.

## 2. Pending-state storage — DECISION NEEDED (migration vs no-migration)

Two options. **I recommend A.** Flagging because A is a (small, additive)
schema migration and the user owns migrations.

### Option A (recommended) — new table `pending_source_choices`

```sql
create table if not exists pending_source_choices (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  user_message_id uuid not null references chat_messages(id) on delete cascade,
  reason text not null,          -- "external-prerequisites" | "recent-subject-follow-up" | ...
  subject text,                  -- nullable; the detected external subject, e.g. "Kubernetes"
  message_text text not null,    -- the original user message (so resume doesn't re-read history)
  created_at timestamptz not null default now(),
  resolved_at timestamptz,       -- set on resume; a background sweep can delete resolved rows
  choice text                    -- "search" | "stay"; set on resume
);
create index on pending_source_choices (thread_id) where resolved_at is null;
```

Why this is the clean + doctrine-safe choice:
- **It is NOT a `chat_messages` row**, so `rowToMistral` (which rebuilds
  Mistral history from `chat_messages`) never feeds the suggestion back to the
  model as an assistant message. The suggestion is a UI artifact, not a real
  assistant answer — it must not enter Mistral's context next turn.
- Turn-scoped by `user_message_id`; trivially queryable ("is there an
  unresolved pending choice for this thread?").
- `resolved_at` + a sweep delete = consumed, not a durable preference. Never
  written to `chat_memories` or durable user context.
- Additive migration (new table appended to `schema.sql`; no existing column
  changes, no backfill). Consistent with the project's additive-migration
  pattern.

### Option B (no migration) — encode the pending choice as an assistant `chat_messages` row

Store the suggestion as a `chat_messages` row (role `assistant`, content = a
JSON envelope `{kind:"pending-source-choice", reason, subject}`), detected on
resume by parsing content. **Rejected** because:
- `rowToMistral` would feed it back to Mistral next turn as an assistant
  message — exactly the re-injection the architecture forbids (would need a
  special-case skip in `rowToMistral`, fragile).
- Reusing a row for a non-answer muddies the message history / debug log /
  `CompanionDebugLog` shape.
- The "consumed, not durable" property is harder to enforce on a row that
  stays in history.

**Decision for the user:** adopt Option A (new table, additive migration) or
Option B? My strong lean is A.

## 3. The detector — `detectExternalVerificationNeed` (delivery step 3, designed here)

Pure, no model call for v1 (reconcile scrutinize #2 — the "low-confidence"
model signal is deferred). Reuses the existing `classifyWebNeed` heuristic +
the Phase A frames + the B.2 cue as *reason sources*, not as autonomous
authorities.

```ts
export type SuggestionReason =
  | "external-prerequisites"   // regex prereq/sequence pattern + external-object cue (B.2 work)
  | "current-public-facts"     // YES_TEMPORAL cue (latest/reviews/release/after/did) on a named external entity
  | "attribution-or-quote"      // "did X say", "who said", "is this quote real"
  | "recent-subject-follow-up" // B.3 provenance: short factual follow-up to a recently web-verified external subject
  | "external-entity-factual"  // FACTUAL_FRAMES on a named external entity (Phase A)

export interface VerificationSuggestion {
  suggested: boolean
  reason?: SuggestionReason
  subject?: string | null   // the external entity/object, if extractable lexically; null if not
}

export function detectExternalVerificationNeed(
  message: string,
  historyRows: ChatMessageRow[],
  siteContext: SiteContext
): VerificationSuggestion
```

Reason-mapping precedence (first match wins; conservative — a too-broad
detector is a naggy companion, reconcile scrutinize #1):
1. explicit controls are handled BEFORE this function (route-level) — by the
   time we call it, it's an `auto` turn with no `/web`/`/noweb`.
2. NOTERMS hit (`my blog`, `my shelf`, …) → `{ suggested: false }` (site
   controls win; no suggestion).
3. B.3 recent-subject provenance hit (a `web_research` audit row with
   `subjectMatch:true` in recent history + a short factual follow-up) →
   `recent-subject-follow-up` with the stored canonical subject.
4. prereq/sequence regex + external-object cue (cue v0: title-like colon OR
   the 54-term software list) → `external-prerequisites` with the object.
5. attribution/quote frame (`did X say`, `who said`, `is this quote real`) →
   `attribution-or-quote`.
6. currentness/reception (`latest`, `reviews`, `release`, `after launch`,
   `current`, `what happened`) on a named external entity →
   `current-public-facts`.
7. FACTUAL_FRAMES (`what is`, `how good is`, `tell me about`) on a named
   external entity (NOT a NOTERM) → `external-entity-factual`.
8. else → `{ suggested: false }` (site-first synthesis, no suggestion).

**Subject extraction** is lexical only for v1 (the regex/cue object, the
provenance canonical subject, the noun after a factual frame). No NER, no
model call. `subject` may be `null` (the suggestion still fires on the reason;
the UI shows a generic form).

**Boundary fixtures (carry over from the matrix, now suggestion-rate not
search-rate):** Spider-Man + Kubernetes prereq → suggest
`external-prerequisites`; "Prerequisites for Inception?" → suggest acceptable
(need not be an auto-search match); Nolan review/release/casting follow-ups →
`recent-subject-follow-up` / `current-public-facts`; Dan Koe attribution →
`attribution-or-quote`; negatives — "Recommend a chair for my desk", "Where do
you go from a breakup?", "Recommend me a book like my new blog post",
shelf/post/vault/bench → NO suggestion (NOTERMS / no external entity).

## 4. Routing policy in the route (delivery step 5)

Replaces the current `webMode` block (route.ts ~196–210). Pseudocode from the
verdict, adapted to the real symbols:

```ts
// explicit controls (unchanged precedence)
if (webMode === "off" || nopost-explicit-no-web) return synthesizeSiteFirst(message, history, siteContext, scopeLabel=null)
if (webMode === "on") return runAuditedWebPipeline(message, history, siteContext)  // existing step-6 pipeline

// auto path — the pivot
const suggestion = detectExternalVerificationNeed(message, priorRows, siteContext)
if (suggestion.suggested) {
  const pending = await insertPendingChoice({ threadId, userMessageId, reason: suggestion.reason, subject: suggestion.subject, messageText: message })
  return Response.json({ pendingChoice: { id: pending.id, reason: pending.reason, subject: pending.subject } })  // no synthesis
}
return synthesizeSiteFirst(message, history, siteContext, scopeLabel=null)
```

Resume (a separate branch at the top of the handler, before the
`appendMessage` user row, since the user row already exists):

```ts
if (body.sourceChoice && body.pendingChoiceId) {
  const pending = await loadPendingChoice(body.pendingChoiceId, threadId)
  if (!pending || pending.resolved_at) return Response.json({ error: "Choice no longer pending" }, { status: 409 })
  await resolvePendingChoice(pending.id, body.sourceChoice)  // sets resolved_at + choice
  if (body.sourceChoice === "search") return runAuditedWebPipeline(pending.message_text, history, siteContext, resumeFrom=pending)
  return synthesizeSiteFirst(pending.message_text, history, siteContext, scopeLabel="Answering from site context; this may not reflect current public information.")
}
```

**Critical:** the resume does NOT re-append the user row (it exists) and does
NOT re-run detection (the choice is already made). The approved branch reuses
the EXISTING audited web pipeline verbatim (the same `web_research` audit +
telemetry + static-guard boundary Phase A captures) — no new search path.

## 5. Client UI contract (delivery step 4)

`ChatUI.tsx`: when a POST returns `{ pendingChoice }` instead of a stream, render
a compact, non-blocking inline block (NOT a modal) attached to the user's
just-sent bubble:

```
This may depend on current public information. I can search and cite
sources, or answer from this site and my existing context.
[ Search public sources ]  [ Stay on this site ]
```

- One tap/click + full keyboard accessible (tab to focus, Enter/Space to
  activate, Esc = stay). a11y: `role="group"`, labelled buttons, focus trap
  NOT needed (inline, not modal).
- Clicking either button sends the resume POST (`{ threadId, sourceChoice,
  pendingChoiceId }`).
- Decline (`stay`) suppresses re-suggesting for that same turn — naturally
  handled: the turn synthesizes site-first and there is no second detection on
  it; the pending row is resolved.
- Don't render the choice if the user already said `/web` or `/noweb` (those
  never return `{ pendingChoice }`).
- Approved answers render the existing "Searched public sources" provenance
  label + audit panel; declined answers render the scope label.
- No `dangerouslySetInnerHTML` (existing rule). Mobile-first: verify the
  inline block at 390px (two stacked buttons if needed).

## 6. Audit / telemetry / security (delivery step 6 tests)

- `DebugTelemetry` gains `suggestion?: { reason, subject, choice }` so the
  debug log records the detection + the user's choice. This is telemetry, NOT
  memory.
- Approved turns write the existing `web_research` audit row (unchanged) +
  telemetry with `choice:"search"`. Declined turns write telemetry with
  `choice:"stay"` and NO `web_research` row (no search ran).
- **No web evidence to memory** — the static guard `chat-web-static-deps.test.ts`
  is extended to also assert: the pending choice table is never read by
  `saveMemory` / `recallMemories` / durable user context; the suggestion/choice
  is never written to `chat_memories`.
- **The pending row is never fed to Mistral** — asserted by a test that
  `rowToMistral` over a thread containing a resolved pending choice does not
  include the suggestion text (it's in a separate table, so this is
  structurally guaranteed, but pin it).
- Admin-only: the whole path is under `/admin/chat` (unchanged); the
  suggestion + resume are admin-gated with the existing `requireAdmin`.

## 7. Mandatory tests (delivery step 6)

TDD — write failing tests first, then implement (delivery step 3 onward):
- **Detector unit:** each of the 8 boundary fixtures → expected
  `{suggested, reason}` (positive Spider-Man + Kubernetes → `external-prerequisites`;
  Inception → suggested; Nolan follow-ups → `recent-subject-follow-up`/
  `current-public-facts`; Dan Koe → `attribution-or-quote`; negatives chair/
  breakup/book-like-my-post/shelf-post-vault-bench → `{suggested:false}`).
- **Precedence:** `/noweb` + a suggested message → site-first, no suggestion,
  no search. `/web` + a non-suggested message → audited pipeline, no suggestion.
- **Resume contract:** approve → runs audited pipeline + assistant row with
  `web_research` + pending row resolved; decline → site-first + scope label +
  no `web_research` + no network call (assert `searchWeb` not invoked) +
  pending row resolved; re-resume a resolved pending → 409.
- **Pause-before-synthesize:** on a suggested turn, NO assistant row is
  appended and NO synthesis runs (assert the suggestion POST appends only the
  user row + a pending row).
- **a11y:** the inline choice is keyboard reachable + activatable; Esc = stay.
- **Audit-boundary (security):** pending choice table never read by
  saveMemory/recall/durable context; suggestion/choice never written to
  `chat_memories`; `rowToMistral` never includes the suggestion; static guard
  extended + green.
- **Decline suppresses same-turn re-suggest:** after a decline, the same
  message text in a new turn is a NEW detection (re-suggest is allowed on a new
  turn — the suppression is within the one turn, which is structurally
  consumed).

## 8. What is NOT in this build (deferred, per the verdict + reconcile)

- Step 4 (ambiguity flag) — deferred.
- Step 5 (post-output assertion guard) — deferred; likely moot (approved search
  + visible "Searched public sources" label is itself the provenance).
- The "low confidence the fact is in site context" model-side detector signal
  — deferred (reconcile scrutinize #2); v1 detector is lexical/heuristic +
  provenance only.
- Conversation-level decline-driven detector fatigue — future observation
  (reconcile scrutinize #4).
- Session-scoped "search automatically in this conversation" control —
  explicitly out of v1 (session-scoped, explicit, revocable, off-by-default is
  the rule, but the control itself is post-eval, delivery step 8).
- Persistent / cross-session auto-search preferences — rejected.

## 9. Open decisions for the user before I write code

1. **Pending-state storage: Option A (new `pending_source_choices` table,
   additive migration — recommended) vs Option B (encode in a `chat_messages`
   row, no migration — rejected for the reasons in §2)?**
2. **Scope of this branch's first PR:** the full 8-step build, or stop after
   steps 3–5 (detector + resume + UI) behind the existing live-test harness
   for an in-process smoke before the real admin smoke (step 7)? My lean:
   build steps 3–6 + the live-test harness (a new
   `verification-suggestion.live.test.ts` driving the real detector + resume
   against the working tree, no SSO/admin/HTTP — same pattern as the existing
   `.live.test.ts` harnesses), THEN ask for the real-admin-smoke go-ahead.

No merge/deploy without explicit go-ahead (A.6 gate). The detector + resume
will be built TDD on this branch; the migration (if Option A) lands in
`schema.sql` and is applied to prod Supabase only with the user's explicit
go-ahead.