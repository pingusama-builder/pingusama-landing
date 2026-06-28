# Pingusama Blog Design Spec

**Date:** 2026-06-28
**Status:** Draft — pending user review
**Topic:** Add a full-featured blog to `pingusama-landing` using Next.js + Supabase

---

## 1. Purpose

Add a blog to the existing `pingusama-landing` site that feels consistent with the current handcrafted, Stardew/parchment aesthetic, while delivering the functionality expected of a modern blog (WordPress-like features minus comments at launch).

The blog must:
- Live at `/blog` on the same domain and in the same Vercel project.
- Offer three ways to publish: browser admin UI, drag-and-drop file import, and Git-pushed markdown.
- Reuse the existing visual tokens and mobile-first rules.
- Be fully self-contained: no outside CMS or third-party blog service.

---

## 2. Context

Current site: a single-file static landing page at `D:\claude projects\Pingusama's Repositories\pingusama-site-mockup-wheel\index.html`, deployed to Vercel. It uses warm color tokens (`--bg`, `--bg-card`, `--terracotta`, `--walnut`, etc.), `Fraunces` display font, `Nunito` body font, and an SVG "workshop compass" wheel.

This design assumes a migration to **Next.js 15 App Router** so the landing page and blog share one build system, one routing layer, and one Supabase project.

---

## 3. Architecture

### 3.1 Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 App Router (React 19) |
| Styling | Tailwind CSS + existing CSS tokens |
| Database | Supabase Postgres |
| Auth | Supabase Auth (magic link / OAuth) for `/admin` only |
| File storage | Supabase Storage for cover images and dropped files |
| Markdown rendering | `remark`, `rehype`, `gray-matter` |
| Search | Postgres full-text search via `to_tsvector` |
| RSS / sitemap | Next.js Route Handlers generating XML |
| Hosting | Vercel (same project as landing page) |

### 3.2 Routes

| Route | Purpose |
|-------|---------|
| `/` | Migrated landing page (wheel + tools + about) |
| `/blog` | Paginated post list |
| `/blog/[slug]` | Individual post page |
| `/blog/category/[category]` | Category archive |
| `/blog/tag/[tag]` | Tag archive |
| `/blog/search` | Full-text search |
| `/admin/login` | Magic-link login for admin |
| `/admin/blog` | Admin dashboard (list posts) |
| `/admin/blog/new` | Create new post |
| `/admin/blog/edit/[slug]` | Edit existing post |
| `/feed.xml` | RSS 2.0 feed |
| `/sitemap.xml` | XML sitemap |

### 3.3 Data flow

Three input channels converge on Supabase Postgres:

1. **Admin UI** — authenticated user writes in browser, saves to `posts` table.
2. **Drag-and-drop import** — user drops `.md`, `.txt`, or `.docx` onto the admin editor; a Vercel API route parses the file and pre-fills the editor (user reviews before publishing).
3. **Git-pushed markdown** — developer writes `.md` files under `content/posts/` and runs an import script that upserts rows into Supabase.

Public pages read from Supabase. Post detail pages use Next.js ISR so new/updated posts appear without a full site rebuild.

---

## 4. Database Schema

### 4.1 `posts` table

```sql
create table posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  excerpt text,
  content_markdown text not null,
  content_html text not null,
  category text,
  tags text[],
  status text not null default 'draft',
  published_at timestamptz,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  author_id uuid references auth.users(id) on delete set null,
  cover_image_url text,
  meta_description text,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(excerpt,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(content_markdown,'')), 'C')
  ) stored
);

create index idx_posts_search on posts using gin(search_vector);
create index idx_posts_status_published on posts(status, published_at desc);
create index idx_posts_category on posts(category);
create index idx_posts_tags on posts using gin(tags);
```

### 4.2 RLS policies

- **Public read:** `select` where `status = 'published'`.
- **Admin write:** `insert`, `update`, `delete` only for authenticated users with the `admin` role (enforced via a custom claim or `app_metadata` in Supabase Auth).

### 4.3 Storage bucket

- Bucket name: `blog-assets`
- Public read allowed for published cover images.
- Write restricted to authenticated admins.

---

## 5. Admin UI

### 5.1 Authentication

- `/admin/login` shows a magic-link form.
- Next.js middleware checks the Supabase session on `/admin/*` and redirects unauthenticated users to `/admin/login`.
- After first login, the user is assigned the `admin` role in Supabase Auth metadata.

### 5.2 Dashboard (`/admin/blog`)

- Table of posts: title, slug, status, published date, updated date.
- Actions: edit, publish/unpublish, delete (with confirmation).
- Filters: all / published / drafts.
- Pagination.
- Button: "New post" and "Import from files".

### 5.3 Editor (`/admin/blog/new` and `/admin/blog/edit/[slug]`)

- Fields: title, slug (auto-generated from title, editable), excerpt, category, tags (comma-separated), cover image upload, status toggle, publish date picker.
- Markdown body textarea with live split-pane preview.
- Save draft button.
- Publish button (sets `status = 'published'` and `published_at = now()` if empty).
- Slug validation: warn on duplicate before save.

### 5.4 Drop-zone import

- A drop zone on the editor accepts `.md`, `.txt`, `.docx`.
- File is uploaded to a temporary Vercel API route.
- API route:
  - `.md` — parse frontmatter with `gray-matter`, body as markdown.
  - `.txt` — treat as markdown body, infer title from first line.
  - `.docx` — use `mammoth` to extract text, treat as markdown body, infer title from first heading.
- Editor fields are pre-filled; user reviews before saving.
- Errors shown inline if parsing fails.

### 5.5 Git-pushed markdown import

- Directory: `content/posts/*.md`.
- Each file uses YAML frontmatter: `title`, `slug`, `excerpt`, `category`, `tags`, `status`, `published_at`, `cover_image_url`, `meta_description`.
- A Node script (`scripts/import-posts.ts`) parses files and upserts rows into Supabase.
- Run manually before deploy or via GitHub Action on push to `master`.

---

## 6. Public Blog Pages

### 6.1 `/blog`

- Eyebrow: "from the workshop".
- Title: "Notes from the workshop".
- Subtitle: "Short posts about building tools, games, and the occasional rabbit hole."
- Paginated list of post cards (newest first), 10 posts per page.
- Each card: title, date, category pill, excerpt.
- Optional sidebar or inline filters for categories/tags.
- RSS link in footer.

### 6.2 `/blog/[slug]`

- Title as H1.
- Meta line: category pill + published date + reading time.
- Optional cover image.
- Rendered markdown body with consistent typography.
- Tag chips at the bottom.
- Previous / next post navigation.
- Open Graph and Twitter card meta tags populated from post fields.

### 6.3 `/blog/category/[category]` and `/blog/tag/[tag]`

- Same layout as `/blog` but filtered.
- Human-readable H1: e.g., "Category: tools".

### 6.4 `/blog/search`

- Search input + submit.
- Results ranked by Postgres full-text search.
- Empty state when no results.

### 6.5 `/feed.xml`

- RSS 2.0 feed of last 20 published posts.
- Includes title, link, description, pubDate, guid.

### 6.6 `/sitemap.xml`

- Lists all public routes: landing page, blog index, all published post pages, category/tag archives.

---

## 7. Design System

Reuse existing landing-page tokens:

- Background: `--bg` (#E8DCC4) with paper-grain noise.
- Cards: `--bg-card` (#F4ECD8) with `--line` border and `--shadow`.
- Typography: `Fraunces` for headings, `Nunito` for body.
- Accent: `--terracotta` (#C97B5C) for links and highlights.
- Pills: reuse `.pill` styles from the tool status badges.
- Mobile: left-align long text, hamburger nav under 640px, single-column cards.

---

## 8. Error Handling

| Scenario | Behavior |
|----------|----------|
| Duplicate slug | Editor shows inline warning; publish blocked until resolved. |
| Parse failure (bad .docx, invalid frontmatter) | Inline error in drop zone; no auto-save. |
| Unauthenticated `/admin` access | Redirect to `/admin/login`. |
| Missing public post | Render styled 404 page. |
| Supabase outage at build time | Build fails loudly in CI so bad deploy is blocked. |
| Supabase outage at runtime | ISR serves cached page if available; otherwise short "workshop is temporarily closed" message. |

---

## 9. Testing

| Type | Coverage |
|------|----------|
| Unit | Slug generation, markdown-to-HTML rendering, excerpt truncation, search query building. |
| Integration | API route parses `.md`, `.txt`, `.docx`; RLS policies block non-admin writes; published posts appear on public routes. |
| E2E (Playwright) | Login → create post → publish → view on `/blog` → search finds it → RSS contains it → mobile nav works. |
| Visual regression | `/blog` and sample post at desktop (1280px) and mobile (390px). |

---

## 10. Migration Plan

1. **Bootstrap Next.js project** in a new branch, copying the current `index.html` content into `app/page.tsx` and global styles into `app/globals.css`.
2. **Recreate landing-page components** (`Wheel`, `DetailPanel`, `Runner`, `Header`, `Footer`) as React components, preserving existing SVG and base64 runner.
3. **Set up Supabase project** (or reuse EPUB tool project if appropriate), create `posts` table, RLS, and storage bucket.
4. **Build public blog routes** (`/blog`, `/blog/[slug]`, category/tag/search).
5. **Build admin routes** with auth and editor.
6. **Add import script** for Git-pushed markdown.
7. **Add RSS and sitemap route handlers**.
8. **Write tests** and capture visual regression screenshots.
9. **Deploy to Vercel** under the existing `pingusama-landing` project.
10. **Decommission old `index.html`** once the Next.js site is live.

---

## 11. Out of Scope (for this phase)

- Comments.
- Multi-author profiles / author archive pages.
- Analytics dashboard.
- Email subscriptions / newsletter.
- Scheduled publishing (posts are published immediately when status flips to `published`).
- Rich-text editor; the editor is plain markdown with live preview.

---

## 12. Open Questions

None at time of writing. All clarifying questions from the brainstorming session have been resolved:
- Full features minus comments.
- `/blog` path on the same domain/project.
- Next.js 15 App Router + Supabase.
- Three input channels confirmed.

---

## 13. Approval

- [ ] User reviewed spec
- [ ] User approved spec or requested changes
- [ ] Implementation plan created via `writing-plans` skill
