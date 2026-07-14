# Web search integration for the site companion — advisor round 1

## 0. What you can use (web search)

You have coupled web search. Please use it to:
- Verify that Mistral's `web_search` / `web_search_premium` tools still only work on `/v1/conversations` and `/v1/agents`, not `/v1/chat/completions`, as of mid-2026.
- Check whether any mid-2026 Mistral API change has added native web search to `/v1/chat/completions`.
- Confirm current pricing for `web_search` and `web_search_premium` if you can find an authoritative source.
- Check whether common third-party search APIs (Serper.dev, Brave Search API, Bing Web Search API) have free tiers or Hobby-friendly pricing for low-volume admin-only use.

Cite what you find.

## 1. Framing

The admin-only site companion has two surfaces: a general chat (`/api/chat`) and a blog writing companion (`/api/blog-companion`). Both currently answer from the live site, a durable memory bank, and design tokens. The user wants to evaluate adding live web search so the companion can answer "what's happening outside the site?" questions without breaking the security boundary (no site writes, no untrusted HTML rendering, admin-only).

The hard part is picking the backend path. The existing client is hard-wired to Mistral `/v1/chat/completions` with streaming + tool calls. Mistral's native `web_search` only works on `/v1/conversations` and `/v1/agents`, which has a different request shape (`inputs`, `tools: [{type:"web_search"}]`) and a different response shape (`outputs[]` with `tool_reference` citation chunks). So "just add web_search to the existing chat call" is not possible on Mistral today.

## 2. The three options on the table

**Option A — Native Mistral `web_search` via `/v1/conversations`**

Add a second thin client (`lib/chat/web-search.ts`) that POSTs to `/v1/conversations` with `tools: [{type:"web_search"}]`. Extract text + `tool_reference` URLs. Format as plain markdown with numbered sources. Inject into the existing `/v1/chat/completions` system prompt (as extra context) or surface as a separate `/api/web-search` route.

- Pros: native billing (no extra vendor key), first-class citations, admin-gated like today.
- Cons: second Mistral API shape to maintain; cannot be mixed into one chat-completions streaming turn, so it needs a pre-turn round-trip or a separate route; extra latency.

**Option B — Third-party search API, keep `/v1/chat/completions`**

Use Serper.dev / Brave Search API / Bing Web Search API to fetch snippets, then inject them into the existing prompt before the model call.

- Pros: single Mistral endpoint, single response parser, can be one turn, provider-agnostic.
- Cons: extra vendor dependency + API key + billing; snippet quality varies; still adds latency/tokens.

**Option C — Defer**

Don't integrate live web search now. The companion already has rich context (site + memory + design tokens). Revisit once a concrete user story can't be solved by that context.

- Pros: no new surface/cost/latency/trust risk.
- Cons: no external fact-checking or recent-event awareness.

## 3. The questions

1. **Ship vs. defer?** Given admin-only usage, rich existing context, and the cost/latency/trust surface, should we ship live web search now or wait for a sharper need?
2. **Backend path?** If we ship, which option is best for a Vercel Hobby Next.js app that already has a custom `/v1/chat/completions` client?
3. **Integration point?** If we ship, should it live in `/api/chat`, `/api/blog-companion`, both, or as a separate `/api/web-search` route?
4. **Trigger model?** Automatic per turn, explicit `/web` prefix, model-invoked `search_web` tool, or a pre-turn research step?
5. **Citation UX?** Is a numbered source list in plain markdown (rendered through `react-markdown` + `rehypeSanitize`) sufficient, or do we need a richer UI?

**What I most want your judgement on:** Q2, Q4, and Q1. My lean: **Option A only if the integration can be small and admin-triggered; otherwise defer.** The deciding factor is Vercel Hobby simplicity — I'm wary of maintaining two Mistral API shapes for a speculative feature.

## 4. Settled constraints (do not re-litigate)

- Security: no site-write imports in chat/companion path; model output uses safe `MarkdownText` (react-markdown + rehypeSanitize); no `dangerouslySetInnerHTML`.
- Admin-only: all companion routes are behind the existing admin gate.
- Vercel Hobby: no cron, no long-lived stateful agents, deploy via `vercel --prod`; `/api/blog-companion` `maxDuration` is 240s.
- Cost: token cost is not the primary concern, but per-call fees + latency matter.
- No second model pass for guardrails.
- Additive only: web search must not break existing behavior when disabled/unconfigured.
