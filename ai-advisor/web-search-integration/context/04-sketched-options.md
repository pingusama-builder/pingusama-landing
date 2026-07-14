# Sketched integration options (not built — design-only)

## Option A — Native Mistral web_search via `/v1/conversations`

Add a new thin client `lib/chat/web-search.ts` that POSTs to `https://api.mistral.ai/v1/conversations` with `tools: [{type:"web_search"}]`. Parse the `outputs` array: extract `text` chunks + `tool_reference` citations. Format as plain markdown with a numbered source block. Inject the result into the existing `/api/chat` or `/api/blog-companion` system prompt as extra context.

How it reaches the companion:
- Pre-turn: before calling `/v1/chat/completions`, detect queries that need web grounding (heuristic or explicit user prefix like `/web`). Call `/v1/conversations` once, format results, append to system prompt.
- No state: no `conversation_id` is persisted; we treat it as a one-shot search tool.
- Security: search text is untrusted; it flows only through the existing safe render path (react-markdown + rehypeSanitize / MarkdownText, no `dangerouslySetInnerHTML`).

Pros:
- Native Mistral billing/no extra vendor key.
- Citations are first-class (`tool_reference` chunks).
- Can be admin-gated, same as today.

Cons:
- A second Mistral API shape to maintain.
- Cannot be mixed into a single `/v1/chat/completions` streaming turn; needs a separate round-trip before or alongside the chat turn.
- Latency: extra HTTP request before the model answers.

## Option B — Bring-your-own search, keep `/v1/chat/completions`

Add a small web-search wrapper around a third-party search API (e.g. Serper.dev, Brave API, Google Custom Search). The wrapper fetches results, extracts snippets + URLs, formats as markdown, and injects into the existing system prompt. The companion model call stays on `/v1/chat/completions` with no API shape change.

Pros:
- Single Mistral endpoint, single response parser.
- Search and chat can be one turn (results injected as system/user context before the model call).
- Provider-agnostic; can swap search backends.

Cons:
- Extra vendor dependency + API key + billing surface.
- Snippet quality / citation format varies by provider.
- Still adds latency and token usage (snippets count toward context).

## Option C — Defer web search for now

Keep the companion grounded on the live site (`buildSiteContext` / `buildWritingContext`), the memory bank, and design tokens. Live web search is not integrated. Future work can revisit once there is a concrete user story that site context + memory cannot satisfy.

Pros:
- No new API surface, latency, cost, or dependency.
- Avoids hallucinated citation risk and third-party snippet trust issues.

Cons:
- Companion cannot answer "what's happening outside the site right now?" questions.
- Less useful for fact-checking recent events, external references, or competitor examples.
