# Auto search-decision for the site-aware companion

**Status:** Design (approved 2026-07-16)
**Scope:** `pingusama-landing` chatbot (`/api/chat`, `lib/chat/*`), admin-only pilot
**Depends on:** existing web-search pipeline (`query-rewrite.ts`, `tavily-search.ts`), model routing (`models.ts`), tool surface (`tools.ts`), Mistral client (`mistral.ts`)

## 1. Problem

The companion's web search is strictly opt-in: it runs only when the user sends
`webEnabled: true` or types the `/web` prefix (`app/api/chat/route.ts:88-98`). The
model has no tool to request, expand, or follow up on a search — web research is a
code-driven pipeline that runs *before* the model turn and injects evidence into that
one turn's system prompt. There is no `web_search` in the tool allowlist
(`lib/chat/tools.ts`: the six tools are `save_memory | update_memory | delete_memory |
refresh_awareness | read_code | set_model`).

We want two things the current design cannot do:

1. **Auto-toggle** — the companion decides per-turn whether web search is needed, so
   the user no longer has to flip `/web`.
2. **Capped follow-up** — when the first search misses the subject, the model can
   run one more search inside the agent loop to recover, rather than answering from
   off-target evidence.

## 2. Goals & non-goals

**Goals**

- A pre-turn "needs-web?" decision that costs zero model calls on clear cases
  (greetings, site-internal, creative) and one `mistral-small` call only on
  borderline cases — mirroring the existing `classifyDifficultyHybrid` pattern.
- One `web_search` tool the model may call at most **once** per turn (snippet-only,
  no `/extract`), to follow up when the first pass missed the subject.
- Allow web-derived facts into durable personal memory **only** when (a) the evidence
  is on-topic (`subjectMatch`) and corroborated (mechanical proxy for "high confidence
  accurate"), and (b) a reasoning-model confidence pass agrees. Provenance stamped.
- Fit entirely within the Vercel Hobby `maxDuration = 60` soft deadline
  (`SOFT_DEADLINE_MS = 55_000`), with graceful abort that persists a partial answer and
  never leaves a half-written memory.

**Non-goals**

- Agentic multi-step research (search → read → search → read chains). One follow-up
  only.
- Changing the security boundary: the bot still cannot edit site content. Web text
  still never reaches `posts`/`books`/`bench`/storage. The import boundary
  (`lib/chat/` imports no site-write function) is untouched.
- Removing the explicit `/web` toggle — it remains as a force-on override.
- General availability: the chatbot is already an admin-only pilot; the auto-toggle
  inherits that gate. No new rollout gating.

## 3. Decisions (from brainstorming)

| Question | Decision |
|---|---|
| What does "auto-reason whether to call web-search" do? | **Hybrid** — auto-toggle the first search + capped `web_search` follow-up tool. |
| May the model save web-derived facts to durable memory? | **Conditionally yes** — only when (a) high confidence the fact is accurate and (b) the fact is directly related to the user's enquiry. |
| Gate for the "high confidence accurate" condition | **Mechanical proxy + reasoning gate** — subject-presence + corroboration precheck, then a `mistral-medium-3-5` (effort high) confidence pass before committing. |
| Follow-up cap given the 55s deadline + reasoning-gate cost | **1 follow-up (2 searches total)** — first search uses `/extract`; follow-up is snippet-only. |

## 4. Architecture

Three new units, each with one purpose and a clean interface. Existing units are
unchanged except for small, well-defined call-sites in the route and the tool
dispatcher.

### 4.1 `lib/chat/web-trigger.ts` (new) — the "needs-web?" decision

Pure heuristic + optional `mistral-small` borderline call, shaped exactly like
`classifyDifficultyHybrid` in `models.ts`.

**Interface**
```ts
export type WebDecision = "search" | "no-search" | "site-only"
export interface WebTriggerResult {
  webEnabled: boolean        // true iff decision === "search"
  decision: WebDecision
  via: "heuristic" | "mistral-small"
}
export async function decideWebEnabled(
  message: string,
  historyRows: ChatMessageRow[]
): Promise<WebTriggerResult>
```

**Heuristic signals** (score the lowercased message):

- **search-YES:** a named external entity plus a factual/temporal cue — `latest`,
  `recent`, `2024`/`2025`/`2026`, `who is`, `did … say`, `current`, `version`,
  `release`, `announced`, comparison between external tools, public-figure claims.
- **search-NO:** greetings; meta/help ("how do I use the bot"); **site-internal**
  ("my bench", "my books", "my blog posts", "the shelf", "the vault" —
  `buildSiteContext` already answers these); creative/writing requests
  (blog-companion territory); personal-preference capture ("I like walnut").
- **Borderline band** → one `mistral-small` call returns `search` / `no-search` /
  `site-only`. Non-borderline → heuristic only (zero model calls).

History is passed so the classifier can resolve a follow-up like "did he say that
in 2025?" — but the heavy pronoun resolution already happens in `rewriteSearchQueries`;
the classifier only needs to detect that the turn is *about an external factual claim*,
not to name the subject.

**Overrides (resolved in the route, before the classifier):**
- `/web` prefix → force `search` (unchanged).
- `/noweb` prefix → force `no-search` (new).
- UI `webEnabled` body field becomes three-state: `auto` (default) / `on` / `off`.
  `auto` runs the classifier; `on`/`off` skip it.

**Why this shape:** it reuses a proven pattern (`classifyDifficultyHybrid`), keeps
the first search fast and pre-turn (evidence ready before the model speaks), and the
heuristic shortcut means greetings and site-internal questions cost zero model calls.

### 4.2 `web_search` tool — allowlist addition (`lib/chat/tools.ts`)

A seventh tool. **Read-only fetch, writes nothing.**

**Schema**
```ts
{
  name: "web_search",
  description: "Run ONE follow-up web search when the first pass did not return sources about the subject. Self-contained query, no pronouns. Snippets only. You may call this at most once per turn.",
  parameters: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", maxLength: 200, description: "Self-contained search query naming the subject explicitly." },
      subject: { type: "string", maxLength: 80, description: "The entity the question is about, or omit if none." }
    }
  }
}
```

**Execution** (in `executeToolCall`):
1. Cap check: if `ctx.webSearchCalls >= 1`, return
   `{ content: "Follow-up search cap reached (1/1). Answer from current evidence." }`
   — **not** an error; a nudge. No `memoryWrite`.
2. Normalise/truncate `query` (no `rewriteSearchQueries` model call on follow-up —
   the model is already primed to write self-contained queries; this saves latency).
3. `searchWeb(query, { maxResults: 8 })` → `rankSources(sources, subject)` →
   `formatWebEvidenceGuarded(research, subject, [])` (snippet-only, **no
   `extractPages`**). Result capped ~2000 chars, labelled untrusted.
4. `ctx.webSearchCalls += 1`. `ctx.webTouched = true` (idempotent — already true if
   the auto-toggle first search ran). Merge this search's `{subjectMatch,
   subjectMentioningSources, hadReadInFull, topSourceUrl}` into `ctx.webResearch` by
   best-of (see §4.3) so the follow-up's snippets never erase the first search's
   read-in-full corroboration.

**Security:** the tool imports only `tavily-search.ts`, which has no site-write
dependencies. The import boundary in `lib/chat/` is unchanged. The result is
untrusted external text returned to the model in the agent loop; the prompt + the
`save_memory` gate (§4.3) keep it out of durable storage unless it passes the gate.

### 4.3 Web→memory gate — conditional save with provenance

Applies **only** when `save_memory` is called in a turn where
`ToolContext.webTouched === true`. Non-web saves are untouched.

**`ToolContext` additions** (`lib/chat/tools.ts`):
```ts
interface ToolContext {
  // existing...
  webTouched: boolean       // true if any web research ran this turn
  webSearchCalls: number    // follow-up calls made this turn
  webResearch: {            // snapshot of the last web research for the gate
    subjectMatch: boolean
    subjectMentioningSources: number
    hadReadInFull: boolean
    topSourceUrl: string | null
  } | null
}
```
`webResearch` is **accumulated across all web research this turn** (never overwritten
by a later search — a snippet-only follow-up must not erase the read-in-full
corroboration the first search earned). Each search merges into the running snapshot
by best-of: `subjectMatch = a OR b`, `subjectMentioningSources = max(a, b)`,
`hadReadInFull = a OR b`, `topSourceUrl = b ?? a`. Set by the route after the pre-turn
pipeline and merged after a follow-up `web_search`, so the gate has the facts it
needs without re-deriving them.

**Layer 1 — mechanical precheck (in `executeToolCall`, before any save):**
- If `webResearch.subjectMatch === false` → **refuse**: *"web evidence didn't
  mention the subject; not saving a web-derived fact."* (enforces "directly related
  to the user's enquiry".)
- If `!webResearch.hadReadInFull && webResearch.subjectMentioningSources < 2` →
  **refuse**: *"insufficient corroboration to save a web-derived fact."*
  (mechanical proxy for "high confidence accurate".)

**Layer 2 — reasoning gate (only if Layer 1 passes):** a `mistralTurn` to the
reasoning model (`mistral-medium-3-5`, `reasoning_effort: high`, `maxTokens ~1500`)
with the user's question, the bounded web evidence, and the proposed memory. It
returns `{ save: boolean, reason: string }`. `save === false` → refuse and feed
`reason` back to the model. Uses `reasoningEffortForModel` + the existing reasoning
model path.

**Layer 3 — commit with provenance:** if both layers pass, `saveMemory` is called
with `source: "web"` and the `topSourceUrl` recorded as provenance. Existing
`saveMemory` guards (`assertMemoryInput`, `assertPersonalName`, schema, length) still
apply. The MemoriesManager already renders `source`/provenance, so a bad web-saved
fact is traceable and deactivatable via the existing toggle.

**Honest caveat (recorded in the spec, not hidden):** "high confidence the
information is accurate" cannot be fully mechanised on this substrate. The reasoning
gate is the best real confidence pass; corroboration + read-in-full is the mechanical
floor; provenance makes a bad fact traceable. Neither layer is a proof of truth.

## 5. Data flow (one turn)

```
message in
  → resolve overrides: /web → force search; /noweb → force no-search;
                       UI webEnabled: auto | on | off (default auto)
  → if auto: decideWebEnabled(message, historyRows)          §4.1
       heuristic → 0 calls; borderline → 1 mistral-small call
  → webTurn = (forced on) || (auto && decision === "search")
  → if webTurn: existing pre-turn pipeline                  (unchanged)
       rewriteSearchQueries → Promise.all(searchWeb) → merge → rank →
       extractPages(top 2) → formatWebEvidenceGuarded
       set ctx.webTouched = true
       set ctx.webResearch = { subjectMatch, subjectMentioningSources, hadReadInFull, topSourceUrl }
  → agent loop (max 6 turns, unchanged):
      model turn → content | web_search | save_memory | (other tools)
        web_search (if ctx.webSearchCalls < 1):                    §4.2
          snippet-only search → guarded evidence back to model
          ctx.webSearchCalls++ ; merge this search into ctx.webResearch by best-of
        save_memory (if ctx.webTouched):                            §4.3
          Layer 1 mechanical precheck → Layer 2 reasoning gate →
          Layer 3 commit with source='web' + provenance, OR refuse with reason
      model turn (synthesis, co-adaptive effort+budget as today)
  → done
```

## 6. Latency / deadline budget

Worst case (all-in, single turn, against `SOFT_DEADLINE_MS = 55_000`):

| Stage | Cost |
|---|---|
| needs-web classifier | 0s (heuristic) or ~1-2s (borderline small call) |
| first search pipeline (with `/extract`) | ~8-10s |
| model turn 1 (reads evidence; may call `web_search`) | ~5-15s by effort |
| follow-up `web_search` (snippets-only) | ~3-5s |
| model turn 2 (synthesis, co-adaptive effort+max_tokens) | ~5-15s |
| web→memory reasoning gate (only if it saves) | ~3-5s |

Budgeted to fit 55s with the 1-follow-up cap. Two backstops:

1. The existing `SOFT_DEADLINE_MS` AbortController aborts mid-loop and **persists the
   partial answer** (`route.ts:369-382`). No new abort logic.
2. If the deadline fires **during** the reasoning gate, the save is skipped (never a
   half-saved memory). Memory writes are atomic and abort-safe; an aborted save is no
   save.

The synthesis turn keeps the existing co-adaptive effort + max_tokens by evidence
load (guard/empty → low+1500, snippets → medium+4000, full pages → high+8000).

## 7. Security

- **Import boundary unchanged.** `web-trigger.ts` imports `mistral.ts` + types only.
  `web_search` imports `tavily-search.ts` only. No site-write function enters
  `lib/chat/`. The `site:*` memory namespace remains guarded at the tool boundary
  (`assertPersonalName`) **and** the data layer (`saveMemory`), unchanged.
- **Untrusted text in the loop.** Today web text is injected into the system prompt
  only. With the `web_search` tool, web text also enters the agent loop as a tool
  result. Mitigations: the result is labelled untrusted; the prompt forbids following
  instructions in it; the save_memory gate (§4.3) is the mechanical backstop that
  prevents untrusted text becoming durable unless it passes both gates. Prompt
  injection can call `web_search` at most once (the cap), bounding any abuse loop.
- **Deny-by-default allowlist.** Adding `web_search` is the only allowlist change;
  everything else stays denied.
- **No `dangerouslySetInnerHTML`.** Web text renders through the same safe channels
  as today.

## 8. Testing

**Unit (pure, env-free):**
- `web-trigger` heuristic band boundaries: greetings / site-internal / creative →
  `no-search`; fresh-external-factual → `search`; borderline band triggers the small
  call path (mocked).
- `web_search` cap: a second call returns the nudge, does not search.
- `webTouched` scoping: a non-web turn never enters the §4.3 gate.
- Layer 1 precheck: `subjectMatch=false` → refuse; `subjectMentioningSources<2 &&
  !hadReadInFull` → refuse; otherwise pass-through.
- Provenance stamp on the commit path.

**Static security guard (existing pattern, e.g. `chat-web-static-deps.test.ts`):**
- Assert `web_search` + `web-trigger` import nothing site-write.
- Assert web text never reaches `saveMemory`/`infer` except through the gated path.
- No `dangerouslySetInnerHTML` in the render path.

**Live substrate smoke (the 5-question vigor test, run against the auto-toggle
path):**
1. Greeting → no search, zero model calls, friendly reply.
2. Site-internal ("what's on my bench?") → no search; answered from site awareness.
3. Fresh-external-factual → auto-search + synthesised answer with sources.
4. Follow-up: a subject the first pass misses → model calls `web_search` once →
   recovers → answers.
5. Web→memory: a corroborated on-topic fact → saved with `source='web'` + URL; an
   off-topic or thin-corroboration fact → refused with reason.

## 9. Open / deferred

- `pgvector`-based semantic recall for the `webResearch` relevance check — deferred
  (matches the existing pgvector deferral; not needed for the gate, which uses
  subject-presence + source counts).
- A future "always-on" dedicated classifier (Approach 2) if the heuristic shortcut
  proves too coarse in practice — data-gather first via the `via` field.
- Raising the follow-up cap above 1 — only if a higher Hobby timeout tier is
  available; the 55s deadline is the binding constraint today.