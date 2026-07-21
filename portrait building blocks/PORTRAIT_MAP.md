# PORTRAIT_MAP — living map of the Pingusama portrait project

> **Living, not final.** Describe what exists; flag what's unknown; do NOT prescribe a finished architecture (the writing-module lesson: don't bake premature shape). Update whenever a module earns a new state or a relationship clarifies. Companion to `PORTRAIT_LOG.md` (append-only).
>
> Last updated: 2026-07-22.

## Shared doctrine (portrait-wide, observed across modules — NOT invented)

These recur across rooms; recorded as shared, not book-specific:
- **鈺氣 lens** — "defies rigid defining": refusal of rigid genre/status shelves, not a master-theme prompt. No mandatory common thread (if one emerges, serendipity — leave it, don't enforce). Per-room/per-work only; cross-room/cross-work noticing is gated + removable, never an architectural centre.
- **Never seek complete portrayal** — incompleteness is ethical protection. "Still collecting" / "left silent" / "sealed" are valid visible states. No completeness indicator is ever rendered.
- **Hands in the loop** — no AI-authored self-description/synthesis about Robin without Robin's gate.
- **Evidence discipline** — only Robin's words/selections bind (`user` provenance); `engine-fact` / `external` / `gloss` are interpretation aid / reference fuel, never evidence of Robin.
- **Optional connections only** — adjacencies are removable noticings, not admissions.
- **Time layers, never overwrite** — earlier states preserved, not replaced.
- **Peer rooms, not hierarchy** — no room ranks another.

## The big portrait

**Shape: EMERGING** — assembled from its modules; not designed top-down. *"As we develop each individual module, we get closer to the actual shape of the portrait itself"* (Robin, 2026-07-21). No top-level schema yet; this map IS the current best approximation. When a module earns a new state, update here + append to `PORTRAIT_LOG.md`.

## Modules / rooms

### VN room
- **State:** VN portrait built (`my-app/public/portrait/vn.html`); VN finder → portrait evidence pipeline; `route-claim-extraction` (cross-work threads as observations-not-synthesis, the precedent the books candidate-echoes follow); reading-thread; the **雨音 gloss lesson** (flag don't guess on foreign names) originated here.
- **Open:** carried from the VN arc (see VN-side memory/CHANGELOG).

### 靈氣之作：書 (books) room
- **State:** research flow DONE; **owned-editions registry DONE** (2026-07-21). Canon = **24** (expanded 20→24 on 2026-07-21). Evidence layer (canon / notes-verbatim / fact-sheet / world-take / provenance-contract) + deep research **v1** (7 group files, archived as deep archive) + **Method v2 trim** (scholarly B3 dropped; ≤3 searches/work; ~2–3 KB/work; `_deep/expansion-2026-07-21.md` for the 4 new works, ~$3.5 under the budget-guard ceiling). Threshold shelf page PROPOSED, NOT built (brainstorming HARD-GATE). Candidate-echoes gated (10 + 4 expansion-shift flags pending Robin).
- **Room principle (stated by Robin 2026-07-21, doctrine):** *books as physical objects with human traces of reading — dog-eared, margin notes, highlights — embodied reading.* The room is about Robin's physical copies and the traces of reading in them, not books-as-text. Margin notes sit at the overlap of this room and the **writing module** (Robin's own writing in the book) — relationship TBD.
- **Owned-edition / favorite-cover metadata shape (SETTLED 2026-07-21):**
  - `ownedEdition` supports **N editions per canon title + one `primary`** (Robin owns multiple physical copies of several titles; the primary is the displayed face). Confirmed: 15/24 canon titles owned, **36 editions** in the registry; 9 not-owned (5 wuxi confirmed not-owned + How Proust / Different Seasons / Eleven Kinds / Frieren-as-single-edition not in library).
  - **Owned ≠ canon ∩ Excel.** Beach Read (and others) proved Robin owns canon books the Bookshelf export missed; manual ISBN path + authoritative photo path are required.
  - **Cover cascade (settled):** Google Books by volume id (matches the site bench) → Open Library by ISBN → **博客來** `search.books.com.tw` by Chinese title for CJK editions that Google/OL lack → **photo of Robin's copy** as the embodied authoritative tier. Frieren vols 1,3–14 covered via 博客來 exact title search `葬送的芙莉蓮 (N)`; vols 2,5,7 have no ISBNs but their covers were fetched the same way.
  - `favoriteCover` remains **proposed only** (manual, separate, not owned) — not built.
- **Artifacts:** `portrait building blocks/books/*` + `_deep/*`; EPUB `靈氣之作-書-portrait-research-flow.epub` (514 KB / 15 ch; rebuild pending to include the expansion file). New registry artifacts: `owned-editions.json` (fact-sheet v2 draft), `_registry.html` (self-contained, covers + photos), `_registry.cover-cache.json`, `_registry.covers.json`, `_registry.photos.json`.
- **Visual interactive library — v2 prototype DONE + DEPLOYED 2026-07-22.** Direction: Eastward / A Space for the Unbound style warm interior pixel-art room; Zelda-style fade-to-black sub-screen transition for the book-spine wall zoom-in; Pillow 12 pixel-art spine rasterization (28×44 + 16-color median cut) from real covers; e-book projection station for the 3 digital-only canon titles. Wuxia canon titles (6 titles: 笑傲江湖 / 神鵰俠侶 / 小李飛刀 / 絕代雙驕 / 楚留香傳奇 / 覆雨翻雲) remain split off — Robin has a separate idea for them. Scope = the other owned/canonical non-wuxia titles. Files: `books-room-mvp.html` (earliest), `books-room.html` (v1, 2026-07-21), `books-room-v2.html` (current, 5.74 MB self-contained) + builder `_build_books_room_v2.py`. Deployed to `https://pingu-tinkering.vercel.app/portrait/books` (commit `cedbe29`, deployment `dpl_CQ7CkUHeteq6HbRKyKixxhwNaNq7`). **Rule for books without physical photos:** show API cover + edition info only; no placeholder fake content (option B).

### Writing module (shape UNKNOWN)
- **State:** SHAPE UNKNOWN. Eventual home for Robin's own writings (per-book notes, blog posts about canon books e.g. The Humans / Matt Haig, any prose). `_incoming-notes/` is a **holding inbox, not a destination**. Under brainstorming HARD-GATE — no premature shape.
- **Open:** the writing-module brainstorm (gauge first via process-fit-gauge; may be LIGHT or HEAVY).

### The site (pingusama-landing)
- **State:** Vercel @ pingu-tinkering.vercel.app; bench (book-wagon) + public blog + admin editor + admin-only site-aware companion chat (RAG over posts, durable memory). Auto-deploy broken; prod ships via CLI.
- **Relationship to portrait:** where portrait rooms may eventually render (proposed books shelf page → `/portrait/books` mirroring `/portrait/vn`). The companion chat is site-aware but architecturally cannot edit site content (security boundary).

## Relationships between modules
- **Writing module ← spans rooms:** per-book notes currently captured in `books-notes-verbatim.md` (books room's gloss layer); the writing module will ultimately hold these (`books-notes-verbatim.md` may become a projection/subset of it).
- **Books room → site:** the proposed threshold shelf page renders at `/portrait/books` (mirroring `/portrait/vn`).
- **VN room → books room:** the books research flow is the book-analog of the VN finder → portrait evidence pipeline (`route-claim-extraction` → candidate-echoes; 雨音 gloss lesson → name-verification doctrine).
- **Companion chat → all rooms:** site-aware RAG over posts; cannot edit site content.

## Shape notes (accumulating — append to PORTRAIT_LOG when earned)
- The portrait assembles **bottom-up** from modules; the map is the running approximation, not a top-down schema.
- Doctrine is **shared across rooms** (鈺氣 lens + standing constraints apply portrait-wide, not just books).
- "Peer rooms, not hierarchy" — the writing module is a peer layer, not above the rooms.
- Each module's development is a probe that clarifies the portrait's shape — log the clarification, don't enforce a premature one.