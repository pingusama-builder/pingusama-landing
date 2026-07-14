# Index — read in this order

Start with `PROMPT.md` (the five questions). Then read the bundled files for context. Each is reproduced verbatim under a `## <path>` heading.

## Reading order

1. **`context/01-current-chat-client.md`** — the existing Mistral `/v1/chat/completions` client every route uses. Key point: it does not support built-in `web_search`.
2. **`context/02-current-route-shapes.md`** — the streaming agent loops in `/api/chat` and `/api/blog-companion`, plus the security boundary as written in the route comments.
3. **`context/03-mistral-docs-web-search.md`** — what Mistral docs say about `web_search`: works only on `/v1/conversations`/`agents`, request/response shape, pricing.
4. **`context/04-sketched-options.md`** — three design options (A = native Mistral Conversations API, B = third-party search + existing Chat Completions, C = defer), with pros/cons.

## Conventions to know

- Project: Next.js 16 + Vercel Hobby + Supabase `kuyytbmmvxcmiyxqsnpe`.
- Models in use: `mistral-small-latest`, `mistral-medium-latest`, `mistral-large-latest` (and `mistral-medium-3-5` for optional reasoning substrate experiments).
- Companion runs on `/api/chat` (general chat) and `/api/blog-companion` (writing companion). Both admin-gated.
- Rendering path: `react-markdown` + `rehypeSanitize`; no `dangerouslySetInnerHTML`.
- No site writes from the bot/companion path; the dispatch allowlist is the security boundary.
