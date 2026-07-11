# Design — Site-aware LLM chatbot (admin-only pilot)

**Date:** 2026-07-11
**Status:** Pre-approved by user; built as a rough pilot for live testing.
**Subject:** Pingusama's Tinkering — a general-purpose assistant that knows the site as background, gated admin-only, with a persistent memory system as its centerpiece.

## Goal

A chatbot on the existing Next.js 16 site that (a) answers arbitrary questions like a general assistant, (b) knows the site's content (blog posts, bench shelf, tool wheel, vault clips) and code, and (c) **gets better over time** via a persistent, self-refining memory system. The memory system is the centerpiece and the structural advantage over a browser-bound Gemini that can only read the rendered snapshot: this bot runs server-side, can read the site's code, and tracks how each category evolves.

Pilot scope: **admin-only** (behind the existing Supabase `app_metadata.role === "admin"` gate). No public surface. Token cost is not a constraint.

## Non-goals (deferred)

- Public access + rate limiting (admin-only for now).
- End-of-conversation reflection pass and a content-advisor proposal queue (passive recall chosen; the advisor *emerges* from remembered patterns + `idea`-type memories).
- pgvector semantic recall (schema reserves an `embedding` column; recall loads all active memories now, swaps to filtered/semantic later without changing callers).

## Architecture

```
admin browser ──SSE──> app/api/chat/route.ts (admin-gated, maxDuration=60)
                         │
                         ├─ recallMemories() + load site:* awareness  → system prompt
                         ├─ Mistral chat completions (streaming + tool calling)
                         │     tools: save_memory / update_memory / delete_memory
                         │            refresh_awareness / read_code
                         ├─ dispatch tool calls → lib/db/chat.ts (Supabase service client)
                         └─ stream assistant content to client

Supabase (service-role, RLS-locked):
  chat_memories  (user/feedback/project/reference/idea/site)
  chat_threads   (resumable conversations)
  chat_messages  (thread history → sent as prior turns)

Prebuilt at build time: code-map.json (read_code source; serverless-safe)
```

## Memory system (centerpiece)

### `chat_memories` table

| column | type | purpose |
|---|---|---|
| id | uuid pk | |
| type | enum `user \| feedback \| project \| reference \| idea \| site` | `site` = auto-maintained awareness |
| name | text | kebab slug; unique among `active=true`. `site:*` namespaces awareness by category |
| description | text | one-line; recall relevance key |
| content | text | the fact; `feedback`/`project` follow `**Why:**` / `**How to apply:**` |
| links | text[] | related memory `name`s (`[[name]]` cross-links) |
| source_thread_id | uuid fk→chat_threads, null | provenance |
| fingerprint | text null | for `site:*`: hash of source state at last sync |
| embedding | vector(1536) null | reserved for future pgvector recall (null now) |
| last_used_at | timestamptz | bumped on recall; future decay |
| created_at / updated_at / last_synced_at | timestamptz | |
| active | bool default true | soft delete (curation reversible) |

RLS: service-role only (matches `books`/`posts`).

### Recall — `recallMemories({ query?, types?, category?, limit? })`

Single chokepoint, query-aware from day one. Now: all `active=true`, ordered `last_used_at desc`, cap ~40, full content in system prompt; bumps `last_used_at`. Later: type-filter + `embedding` semantic rank vs `query` — callers unchanged.

### Write/update/delete — bot tools (server-validated)

- `save_memory({ type, name, description, content, links? })` — upsert by `(active, name)`.
- `update_memory({ name, content, description? })` — refine existing (how it gets *better*, not just bigger).
- `delete_memory({ name })` — soft-set `active=false`.

Tool descriptions bake in hygiene + the **promotion rule** (from the self-learning skill): only write when durable and verified, not a transient chat moment; check for an existing memory to update before creating; never save what's already derivable from site content or code. Server validates type + slug + dedupe.

## Site awareness (RAG by category)

Five `site:*` memories, one per category: `site:blog`, `site:shelf`, `site:vault`, `site:tools`, `site:code`. Each holds synthesized `content` + `fingerprint` + recent deltas.

- **Recall = retrieval:** on a question, the bot pulls the relevant `site:*` memory(ies) + personal memories; raw detail fetched on demand (token cost not a concern). Per-category memories are the retrieval index.
- **`refresh_awareness({ category? })`** — deterministic (no LLM): reads live source, diffs vs stored `fingerprint`, restructures the `site:*` memory, notes what changed. Blog→`getPosts`, shelf→`loadShelf`+`resolveShelf`, vault→`loadVault`, tools→import `TOOLS`, code→code-map.json. Fast; runs in-request as a staleness check, behind a manual button, or a daily cron.
- **`read_code({ feature|path })`** — returns the code-map entry (purpose, exports, deps, full content for small key files). How the bot understands new features.
- **Code map:** `scripts/build-code-map.ts` walks `app/` `components/` `lib/`, emits `code-map.json` (routes→files, components→one-line purpose from leading comments, tools, data sources, env vars, key-file contents). Prebuilt (zero runtime cost), serverless-safe. Regenerates on rebuild so new features appear.

Change-tracking is the capability a browser-Gemini structurally lacks (it sees only the current snapshot).

## Conversation persistence

`chat_threads` (id, title, created_at, updated_at) + `chat_messages` (id, thread_id, role, content, tool_calls jsonb, created_at). Thread history sent as prior turns; conversations resumable/reviewable; `source_thread_id` gives memory provenance. Cheap, useful for a companion, and the substrate for a future reflection pass.

## Trigger UX

- `/admin/chat` — full-page chat, admin-gated. Thread list (resume), message stream, composer. Fraunces display / Nunito body / existing warm-cream tokens. Mobile-first, verified at 390 px.
- `/admin/chat/memories` — management UI: memories grouped by type; `site:*` grouped separately (bot-managed, with last-synced + changed-since + manual refresh). Edit content, toggle active, delete. Search/filter. The seed of the "real memory management system."

## API route + Mistral

- `app/api/chat/route.ts`, `export const maxDuration = 60` (safe floor if Fluid Compute not enabled; 300s available with it).
- Admin-gated via `requireAdmin` (reuse `lib/auth.ts`).
- Agent loop: Mistral chat completions with native tool calling + SSE streaming. Stream assistant content to client; execute tool calls between turns; cap at N turns (e.g. 6) and a per-turn memory-write cap (e.g. 3) to prevent runaway.
- `lib/chat/mistral.ts` — thin client over `https://api.mistral.ai/v1/chat/completions`. `MISTRAL_API_KEY` required; `MISTRAL_MODEL` optional (default `mistral-medium-latest`).
- `buildSiteContext()` — single chokepoint assembling site content into the system prompt; strategy swappable later (digest+fetch) without touching callers.

### System prompt shape

- Persona: general assistant that knows this site intimately, in the site's warm register.
- Site context (via `buildSiteContext`): 4 tools, shelf books+notes, vault clips, blog post index (title/slug/excerpt/category/date/tags) — full bodies fetched on demand.
- Recalled memories (personal + relevant `site:*` awareness).
- Hygiene + promotion-rule instructions for memory tools.
- Scope note: admin-only pilot, the user is the site owner.

## Limits / errors / emptiness

- `max_tokens` sane (e.g. 800) so a generation finishes in seconds.
- Agent loop turn cap + per-turn memory-write cap.
- No Mistral key → route returns a clear 503-style error ("Mistral key not configured") not a crash.
- Empty thread → invitation to ask; empty memory bank → explanation + prompt to chat so the bot can start learning.
- Errors explain what went wrong + how to fix, in the interface's voice; never apologize, never vague.

## Security — the bot cannot harm the site (architectural, not prompt-based)

The site is public; the bot must be incapable of editing site content regardless of prompt injection in chat messages or in read-in site content (blog bodies, vault notes, code comments). Guarantees, enforced in code:

1. **Scoped tool surface.** The only tools exposed to the model are `save_memory`, `update_memory`, `delete_memory`, `refresh_awareness`, `read_code`. Every one touches only `chat_memories` or reads static source. **No tool can write to `posts`, `books`, `bench`, Storage, or code.** The site-content write functions (`createPost`/`updatePost`/`deletePost`/`saveShelf`/`saveVault`/`mirrorCover`/`warmBook`/`uploadBlogImage`) are never imported in the chat code path — the capability is absent, so injection cannot reach it.
2. **No raw SQL from user/tool input.** All DB access is via fixed typed functions + Supabase parameterized queries. Tool args are schema-validated server-side before any DB call: `type ∈ {user,feedback,project,reference,idea,site}`, `name` matches `^[a-z0-9-:]+$` with length cap, `content` length-capped. Injection in args cannot reach SQL.
3. **`read_code` cannot read arbitrary files or secrets.** It reads only the prebuilt `code-map.json`, built from a conservative allowlist that **excludes `.env*` and all secret files**; only small safe files get full content. No general read-file-by-path tool exists, so injection cannot exfiltrate `.env.local` (Mistral/Supabase keys).
4. **Rate caps.** Per-turn memory-write cap (≤3) + agent-loop turn cap (≤6) prevent memory-bank flooding.
5. **Soft delete.** `delete_memory` sets `active=false` (reversible from the admin UI). The worst a successful injection can do is pollute the bot's own memory — recoverable, never touching the public site.
6. **Admin-only.** Single trusted chatter (the owner); no cross-user memory leakage. The real injection surface is site content read into context, which is sandboxed by (1)–(5).

**Assumption noted:** "no editing/writing access" = no writes to *site content*. The memory bank (chat_memories) is the bot's own isolated scratchpad and is still written to (the centerpiece). If the user clarifies "no writes at all," strip memory-write tools to read-only recall.

## Testing

- Unit (vitest, mocking Supabase + Mistral): memory save/update/delete + dedupe; `recallMemories` filtering + `last_used_at` bump; awareness fingerprint/diff; `buildSiteContext`; route handler with mocked Mistral returns streamed content + executes tool calls; promotion-rule validation rejects transient/derivable saves.
- `npm run build` green; `npm test` green; `npx tsc --noEmit` clean.
- Live smoke test (when `MISTRAL_API_KEY` present): hit the route, confirm a streamed answer + a memory written + recall on next turn. Mobile 390 px eyeball (note: no browser in agent env — flagged in HANDOFF).

## Files (planned)

- `lib/db/schema.sql` (append: 3 tables + RLS)
- `lib/db/chat.ts` — memory + thread + message data layer
- `lib/chat/awareness.ts` — per-category refresh + `buildSiteContext`
- `lib/chat/mistral.ts` — Mistral client
- `lib/chat/tools.ts` — tool definitions + dispatch
- `lib/chat/prompt.ts` — system prompt assembly
- `app/api/chat/route.ts` — SSE route, admin-gated
- `app/admin/chat/page.tsx` + `components/ChatUI.tsx` — chat
- `app/admin/chat/memories/page.tsx` + actions — memory management
- `scripts/build-code-map.ts` + `npm run build-code-map`
- `lib/data/code-map.json` — prebuilt
- `tests/unit/chat.*.test.ts`
- `app/globals.css` — chat styles (existing Fraunces/Nunito tokens only)

## Vercel Hobby fit

Confirmed fits Hobby: serverless maxDuration 300s with Fluid Compute (60s legacy floor — both plenty); Edge runtime option streams up to 300s plan-independent; Supabase free tier holds the tables trivially; code map is prebuilt (no runtime FS). No scope cuts forced by infra. Deferred items (reflection, semantic recall, public access) are the only things that would need queues/Pro later.