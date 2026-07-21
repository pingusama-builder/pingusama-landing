# PORTRAIT_LOG — append-only log for the Pingusama portrait project

> **Append whenever earned** — a module's state changes, a relationship clarifies, a shape observation emerges, a doctrine is learned. **Newest entries at the TOP** (reverse-chronological). One to a few lines per entry. This is the *portrait arc* log (modules + shape + earned learnings); the engineering/shipping log is the separate project `CHANGELOG.md`.
>
> **Rule (binding, saved to memory `portrait-project-log-rule`):** whenever the portrait earns a learning, **append here AND update `PORTRAIT_MAP.md`**. Do not let a module advance without the map + log reflecting it.

---

## 2026-07-22 (visual library v2 — DEPLOYED to production)

- **Books room — visual library v2 prototype DEPLOYED.** Copied `books-room-v2.html` → `my-app/public/portrait/books.html`, added rewrite `/portrait/books` → `/portrait/books.html` in `next.config.ts` (same pattern as `/portrait/atlas` and `/portrait/vn`). Build (`npm run build`) and tests (`npm run test`: 812 passed / 20 skipped) green.
- **Deployment:** pushed master `cedbe29` to `pingusama-builder/pingusama-landing`; production deploy via `vercel --prod --yes --scope thegrandpingu-9836s-projects`. Deployment ID `dpl_CQ7CkUHeteq6HbRKyKixxhwNaNq7`; live URL `https://pingu-tinkering.vercel.app/portrait/books`.
- **Validation:** `curl /portrait/books` returns `200 text/html` and the expected `<title>靈氣之書 v2｜可走入的藏書室</title>`. No link from the main landing page yet — Robin to decide if/when to surface entry points.

---

## 2026-07-22 (books text research — new writings folded + candidate takes extracted)

- **Books room — text research arc resumed.** Folded 4 new Robin writings from `_incoming-notes/` into `books-notes-verbatim.md`:
  - The Humans — `Matt Haig blog post.txt`
  - The Storied Life of A.J. Fikry — `這本書改變了我的人生軌跡-Storied Life of AJ Fikry.txt`
  - Tomorrow, and Tomorrow, and Tomorrow — `Tomorrow x 3-copy for the bookstore I worked for.txt`
  - Daytripper Chinese note — `Daytripper-Chinese writing.txt` (now merged with the English note under one entry).
- **Canon now has 7 user notes (of 24 titles).** Remaining 17 stay note-free (no fake notes). Folded source files moved to `_incoming-notes/_processed/` per inbox rule.
- **Candidate takes extracted.** New artifact `books-writing-candidates.md` lists 3 candidate takes + key verbatim quotes for each of the 7 books with user notes:
  - All the Bright Places, Daytripper, The Name of the Wind, The Conquest of Happiness, The Humans, The Storied Life of A.J. Fikry, Tomorrow, and Tomorrow, and Tomorrow.
- **Name-verification flags recorded:** "Eolain" (Rothfuss) → likely Elodin/Auri; "Emily Dickionson" (Haig) → likely Emily Dickinson. Left verbatim, flagged in `books-fact-sheet.md` and `books-notes-verbatim.md`.
- **Open decisions:** per-work only, no common thread. Next = Robin gates the candidates and picks one book/angle to draft.

## 2026-07-22 (visual library v2 — self-contained prototype built)

- **Books room — visual library v2 prototype built.** New builder `_build_books_room_v2.py` emits `books-room-v2.html` (5.74 MB, self-contained). 15 shelf entries (14 owned non-wuxia titles + Frieren 全 14 卷); the 3 digital-only canon titles are handled by the projection-station interaction instead of empty physical slots. v1 `books-room.html` preserved as reference.
- **v2 design directions implemented:** Eastward / A Space for the Unbound style warm interior pixel-art room; Zelda-style fade-to-black sub-screen transition for the book-spine wall zoom-in; Pillow 12 pixel-art spine rasterization (28×44, 16-color median cut) derived from real covers; e-book projection station on the bottom-left desk with left/right switching.
- **Spine rasterization verified:** 22 edition spines + 14 Frieren volume spines = 36 base64 PNG data URIs, ~1.5–3 KB each. Source of truth chain unchanged: `owned-editions.json` → `books-canon.md` → `_registry.html` covers / `.jpg` photos.
- **E-book covers fetched at build time:** Google Books volume IDs confirmed and embedded — How Proust (`hl0fUeXFJv8C`) / Different Seasons (`lp5vDgAAQBAJ`) / Eleven Kinds of Loneliness (`L3HOAwAAQBAJ`). Note: these three return PNG covers, so the blanket "reject PNG" placeholder guard was relaxed to allow non-placeholder PNGs.
- **Interaction model:** room → walk near shelf → E → sub-screen wall of pixel-art spines → E/Enter opens detail card, Esc returns; projector station on desk → E → projected e-book cover, arrows/click switch, Esc returns. No external network calls at runtime.
- **Validation:** JS syntax passes `node --check`; external-URL grep returns zero; builder re-runs deterministically to 5.74 MB. No merge/deploy.

## 2026-07-21 (visual library direction — continued session)

- **Books room — visual interactive library: prototype first, then site.** Robin decides to build the visual/artifact layer of the books room: a Stardew-Valley-esque, top-down, walkable pixel-art room where the player approaches shelves and "takes out" a physical copy. The taken-out view must show the actual collected print version (cover, spine, edges) and, where available, physical collection traits (margin notes, highlights photos) to manifest *books as physical artifacts with human traces of reading*.
- **Wuxia canon split off from initial visual library.** The 6 wuxia canon titles (笑傲江湖 / 神鵰俠侶 / 小李飛刀 / 絕代雙驕 / 楚留香傳奇 / 覆雨翻雲) are held back — Robin has a separate idea for them. Initial visual library scope = the remaining owned/canonical non-wuxia titles.
- **Photo-less books = quiet display.** For editions with no physical-trait photos, the detail view shows only the API/photo cover + edition metadata. No placeholder fake content, no fabricated margin notes, no "尚未拍攝" nag text — option B.
- **Prototype file:** `books-room-mvp.html` is the starting point; being improved into `books-room.html` (self-contained, real covers/photos from `owned-editions.json` + `_registry.html` + `.jpg` photo files).

## 2026-07-21 (visual library v1 — wrap-up; v2 parked)

- **Books room — visual library prototype v1 DONE 2026-07-21.** Builder `_build_books_room.py` reads `owned-editions.json` + `books-canon.md` + `_registry.html` covers + `.jpg` photos → emits `books-room.html` (5.03 MB, self-contained). 18 shelf entries: 14 owned books + Frieren 全 14 卷 (a series entry that owns a wide top-shelf slot) + 3 absent (How Proust / Different Seasons / Eleven Kinds of Loneliness — these will get a separate e-book projection-station interaction, not empty physical slots). **Bug fixed during v1:** `build_library_data` had `if not items: continue` BEFORE the `is_series` check, which dropped Frieren (its schema uses `volumes`, not `items`); reordered so the series check runs first. **Bug A: parser-ordering. v2 builder must not re-introduce this.**

- **Books room — v2 design directions documented, NOT built.** Eastward / A Space for the Unbound style room detail (more refined pixel art, top-down with warm interior lighting). Zelda-style sub-screen transition for the book-spine wall zoom-in (split view, not free 3D — preserves pixel-art while letting the spines read at full size). Pillow 12 pixel-art spine rasterization (28×44 px + 16-color median cut quantize → ~1.8–2.8 KB per spine PNG) verified against a real cover. E-book projection-station interaction for the 3 digital-only canon titles (mouse click or arrow keys to switch; pixelated covers projected on a virtual surface, not physical slots). Google Books volume IDs for the 3 digital-only titles verified: How Proust `hl0fUeXFJv8C` / Different Seasons `lp5vDgAAQBAJ` / Eleven Kinds `L3HOAwAAQBAJ`. 博客來 exact title search for CJK (used for Frieren vols 2, 5, 7) — validated: exact-match pages have no "推薦" banner, returns distinct volume covers.

- **Books room — session bug (Bug B) — misread "what happen" as a test signal and went silent.** User asked "what happen" mid-build; I incorrectly replied "No response requested." instead of (a) summarizing the current state, (b) asking what they wanted, or (c) acknowledging the misread. User then said "continue" multiple times and finally "what happened"; I eventually surfaced the misread. **Bug B lesson: silence on ambiguous user input is the wrong default — always respond substantively (status, ask, or acknowledge).** Robin called the wrap-up: *"wrap up吧, 這session有bug, clean HANDOFF"*. HANDOFF was updated with a clean v1 section + v2 parking + a fresh visual-library sub-track starter prompt.

- **Books room — sub-track starter prompt added to HANDOFF.** The new sub-track is the *visual library prototype*; existing books research arc starter prompt remains active. The visual-library prompt points the next session at the v1 prototype section + the v1 builder header + the v2 design directions, and calls process-fit-gauge FIRST (don't assume LIGHT). Pillow + Google Books + 博客來 foundations are proven and reusable; the v2 builder only needs to add: tile-level room detail, sub-screen transition, spine-pixelation pass, projection-station interaction. **No merge/deploy without explicit go-ahead.**

## 2026-07-21 (late)

- **Books room — owned-edition / favorite-cover metadata shape SETTLED.** The "proposed" shape is now confirmed: `ownedEdition` supports N editions per canon title + a `primary` flag; cover cascade = Google Books by volume id → Open Library by ISBN → **博客來** by CJK title for Asian editions Google/OL lack → **photo of Robin's copy** as the embodied authoritative tier. Key findings: (1) `owned ≠ canon ∩ Excel` — Beach Read proved the Bookshelf export misses owned books, so a manual-ISBN + photo path is required; (2) Robin owns multiple editions of several titles (Stoner, Kafka, Name of the Wind, Tomorrow², 越讀者, Importance of Living, Frieren 1–14), so one-edition-per-title is wrong. Registry: 15/24 canon titles owned, 36 editions, 9 not-owned. Hachette UK A.J. Fikry dropped per Robin. Frieren vols 2,5,7 fetched from 博客來 by title (no ISBNs). Artifacts: `owned-editions.json` (fact-sheet v2 draft), `_registry.html`, `_registry.covers.json`, `_registry.photos.json`, `_registry.cover-cache.json`.

- **Books room — cover pipeline proven.** Reused the site bench's `GOOGLE_BOOKS_API_KEY` from `my-app/.env.local` and the bench's `lib/covers.ts` logic (placeholder detection, zoom=0/1 fallback). Added 博客來 `search.books.com.tw` title search for CJK (validated: exact-match pages have no "推薦" banner; `葬送的芙莉蓮 (N)` returns distinct volume covers). This is the first time the portrait's evidence layer uses a regional bookstore source rather than a global API.

---

## 2026-07-21

- **Books room — embodied-reading principle (doctrine, stated by Robin):** *books as physical objects with human traces of reading — dog-eared, margin notes, highlights — embodied reading.* The room is about Robin's physical copies + the traces of reading in them, not books-as-text. Recorded in the map as room doctrine. Note: margin notes overlap the **writing module** (Robin's own writing in the book) — relationship TBD.

- **Books room — owned-edition / favorite-cover metadata shape (PROPOSED, not yet confirmed):** two axes — owned edition (ISBN → publisher/year/edition note; ISBN makes cover lookup edition-correct by definition; cascade Open Library → Google Books → photo-of-Robin's-copy as the embodied authoritative tier) + favorite cover (optional, separate, not owned, manual aesthetic drop). Would become fact-sheet schema v2. Holding as proposed per the don't-bake-premature-shape rule; will log + draft schema when Robin confirms.

- **Log + map started** (Robin): *"as we develop each individual module, we get closer to the actual shape of the portrait; start mapping now, keep a log, append whenever earned."* `PORTRAIT_MAP.md` + this log created; rule saved to memory (`portrait-project-log-rule`).

- **Doctrine observed portrait-wide** — the 鈺氣 lens + standing constraints (no common thread, never complete portrayal, hands in the loop, evidence discipline, optional connections only, time layers never overwrite, peer rooms not hierarchy) recur across rooms, not just books. Recorded as shared doctrine in the map.

- **Writing module noticed (shape unknown)** — Robin's own writings (book notes + blog posts incl. The Humans / Matt Haig) belong to a "writing module" of the big portrait whose shape is unknown. `_incoming-notes/` is a holding inbox, not a destination; no premature shape (brainstorming HARD-GATE). Relationship: spans rooms; `books-notes-verbatim.md` may become a projection of it.

- **Books room — canon → 24** — expanded 20→24 (21 《越讀者》郝明義 · 22 Different Seasons Stephen King · 23 Eleven Kinds of Loneliness Richard Yates · 24 Men without Women Murakami). Authors confirmed (Robin's "Yeats" → Richard Yates; 越讀者 → 郝明義). Out-of-scope "Canon Movie" notion seeded (Men without Women's "Drive My Car" → Hamaguchi 2021).

- **Books room — Method v2 trim + expansion research** — after Robin's EPUB review ("scholarly stratum is the least interesting, doesn't add value"), B3 dropped entirely; v2 = A + B1/B2 only, ≤3 searches/work, ~400–500 words/work. Applied to the 4 new works → `_deep/expansion-2026-07-21.md`, 4/12 searches, ~29.5K tokens ≈ $3.5 (under the budget-guard $5 ceiling; ~10×+ cheaper per work than v1). Candidate-echo shifts flagged not edited.

- **Books room — research flow + deep pass + EPUB (earlier same day)** — evidence layer built overnight; deep-research v1 (Methods A/B/C/D, 7 group files, 40–74 KB each) done; EPUB built (514 KB / 15 ch, CJK intact). Robin satisfied with the result.

- **Budget-guard rule + skill** — after the books deep-pass overspend ($25 in one session, $100–155 in prior sessions per ccusage), Robin set a research token-scale rule ($5 / 200K-token / >2-agent gate, tightened from $15/1M) + a `budget-guard` skill (estimate → agree ceiling → check-in at 70% → report; honest that the agent can't read live spend, enforces via estimate + user's `/cost`). Applies portrait-wide to heavy/overnight tasks.