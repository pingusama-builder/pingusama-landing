# Web search integration for the site companion — advisor review

## The design/decision under review

The admin-only site companion (chat at `/admin/chat` + blog writing companion at `/admin/blog/new` and `/admin/blog/edit/[slug]`) currently answers from the live site, the memory bank, and design tokens. The user asked us to evaluate adding **live web search** so the companion can ground answers in current external information without breaking the security boundary (no site-write reach, no untrusted HTML rendering, admin-only).

We need to decide:
1. **Whether to integrate live web search at all.**
2. **If yes, which path to take:** Mistral's native `web_search` on the Conversations API, a third-party search API injected into the existing Chat Completions flow, or some hybrid.
3. **Where it belongs:** `/api/chat`, `/api/blog-companion`, both, or a dedicated `/api/web-search` route.
4. **What UX trigger to use:** automatic per turn, explicit user prefix/command, companion tool call, or a pre-turn "research" step.

## The questions

1. **Should we ship live web search now, or defer?** Given the companion is admin-only, its current context is rich (site + memory + design tokens), and adding live search adds cost/latency/trust surface, is the capability worth the complexity today?
2. **If we ship, which backend path is better?**
   - **A.** Native Mistral `web_search` via `/v1/conversations` (separate endpoint, separate response shape, $0.03/search, first-class citations).
   - **B.** Third-party search API (Serper/Brave/etc.) with results injected into the existing `/v1/chat/completions` prompt (single endpoint, single model call, extra vendor key).
   - **C.** A hybrid: a dedicated `/api/web-search` route that can swap implementations (Mistral Conversations or third-party) behind a common result shape.
3. **If we ship, where does it plug in?** Should web search be available in the general chat (`/api/chat`), the blog companion (`/api/blog-companion`), or both? Should it be a separate tool the model can invoke, or a pre-turn step triggered by the user/model?
4. **What is the safest UX trigger?** Automatic per-turn detection risks hammering the search tool on every question. Explicit `/web` prefix is discoverable but manual. A model tool call (`search_web`) keeps it in the agent loop but requires the model to decide correctly. Which fits the Vercel Hobby cost profile and admin-only usage?
5. **How do we render citations safely?** The site already renders model output through `react-markdown` + `rehypeSanitize` (`MarkdownText`, no `dangerouslySetInnerHTML`). Is a numbered source list in plain markdown sufficient, or do we need a richer citation UI?

**The questions I most want answered:** Q2 (backend path), Q4 (trigger model), and Q1 (ship vs. defer). My lean is **Option A (native Mistral Conversations API) only if we can keep the integration small and admin-triggered; otherwise defer**. The deciding factor is the Vercel Hobby runtime: we already have one custom Mistral client; adding a second endpoint/response shape is acceptable only if the UX gain is clearly worth it.

## Settled constraints (do not re-litigate)

- **Security:** no site-write import in the chat/companion path; no `savePostAction`/`createPost`/`updatePost`/storage/bench/shelf writes; model output uses safe `MarkdownText` (react-markdown + rehypeSanitize, no `dangerouslySetInnerHTML`).
- **Admin-only:** all companion routes are behind the existing admin gate.
- **Vercel Hobby:** no cron, no long-lived stateful agents, deploy via `vercel --prod`. Existing `maxDuration` on `/api/blog-companion` is 240s.
- **Cost awareness:** token cost is not the primary concern, but per-call search fees + latency are.
- **No second model pass:** any guardrails must be mechanical (input-side or post-output), not a second LLM call.
- **Preserve existing behavior:** web search must be additive; the companion must still work when web search is disabled/unconfigured.
