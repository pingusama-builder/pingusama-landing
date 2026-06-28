# Pingusama Blog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the single-file static landing page to Next.js 15 App Router and add a Supabase-backed blog with admin UI, drag-and-drop import, and Git-pushed markdown support.

**Architecture:** Next.js 15 App Router serves both the landing page and blog. Supabase Postgres holds posts; Supabase Auth gates `/admin`. Public routes read published posts. Admin UI writes posts. A Vercel API route parses dropped `.md`, `.txt`, and `.docx` files. A Node script imports `content/posts/*.md` from the repo.

**Tech Stack:** Next.js 15 (App Router, React 19), TypeScript, Tailwind CSS, Supabase (Postgres + Auth + Storage), `gray-matter`, `remark`/`rehype`, `mammoth`, `postgres` or `@supabase/supabase-js`, Vitest, Playwright.

## Global Constraints

- Deploy target: Vercel (same project as existing `pingusama-landing`).
- Blog path: `/blog` on the same domain.
- Database: Supabase Postgres.
- Auth: Supabase Auth magic link, restricted to `/admin`.
- Design: reuse existing CSS tokens (`--bg`, `--bg-card`, `--terracotta`, `--walnut`, etc.), `Fraunces` display font, `Nunito` body font, mobile-first layout.
- No comments at launch.
- Editor is plain markdown with live preview; no rich-text editor.
- Post detail pages use Next.js ISR.
- All new code in TypeScript.

---

## File Structure

```
my-app/
├── app/
│   ├── layout.tsx                 # root layout: fonts, metadata, nav, footer
│   ├── page.tsx                   # migrated landing page (wheel + tools)
│   ├── globals.css                # tokens + base styles
│   ├── blog/
│   │   ├── page.tsx               # post list (paginated)
│   │   ├── [slug]/
│   │   │   └── page.tsx           # individual post
│   │   ├── category/[category]/
│   │   │   └── page.tsx           # category archive
│   │   ├── tag/[tag]/
│   │   │   └── page.tsx           # tag archive
│   │   └── search/
│   │       └── page.tsx           # full-text search
│   ├── admin/
│   │   ├── login/
│   │   │   └── page.tsx           # magic-link login
│   │   ├── blog/
│   │   │   ├── page.tsx           # admin dashboard
│   │   │   ├── new/
│   │   │   │   └── page.tsx       # create post editor
│   │   │   └── edit/[slug]/
│   │   │       └── page.tsx       # edit post editor
│   ├── feed.xml/route.ts          # RSS feed
│   └── sitemap.xml/route.ts       # XML sitemap
├── components/
│   ├── Header.tsx                 # shared top nav
│   ├── Footer.tsx                 # shared footer
│   ├── Wheel.tsx                  # SVG workshop compass
│   ├── DetailPanel.tsx            # tool detail card
│   ├── Runner.tsx                 # base64 sprite animation
│   ├── PostCard.tsx               # blog list card
│   ├── PostBody.tsx               # rendered markdown body
│   ├── TagList.tsx                # tag chips
│   ├── Pagination.tsx             # page numbers
│   ├── SearchBox.tsx              # search input
│   ├── AdminPostTable.tsx         # dashboard post table
│   └── MarkdownEditor.tsx         # split-pane markdown editor
├── lib/
│   ├── supabase/                  # Supabase clients
│   │   ├── client.ts              # browser client
│   │   ├── server.ts              # server client (service role for build)
│   │   └── middleware.ts          # session refresh for middleware
│   ├── db/
│   │   ├── posts.ts               # post CRUD + search queries
│   │   └── schema.sql             # SQL to create posts table
│   ├── markdown.ts                # markdown → HTML + frontmatter parsing
│   ├── slug.ts                    # slug generation / sanitization
│   └── auth.ts                    # admin role helpers
├── scripts/
│   └── import-posts.ts            # import content/posts/*.md into Supabase
├── content/
│   └── posts/                     # git-pushed markdown posts
├── tests/
│   ├── unit/
│   │   ├── slug.test.ts
│   │   ├── markdown.test.ts
│   │   └── excerpt.test.ts
│   ├── integration/
│   │   └── import.test.ts
│   └── e2e/
│       └── blog.spec.ts
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Task 1: Bootstrap Next.js Project and Migrate Existing Landing Page

**Files:**
- Create: all files under `my-app/` listed above (initially scaffolded by `create-next-app`).
- Modify: `app/page.tsx`, `app/layout.tsx`, `app/globals.css` to match current landing page.
- Test: visual regression compares new homepage screenshot to old `index.html`.

**Interfaces:**
- Produces: `Header`, `Footer`, `Wheel`, `DetailPanel`, `Runner` React components.
- Produces: CSS custom properties matching existing tokens.

- [ ] **Step 1: Create Next.js app**

  Run:
  ```bash
  cd "D:/claude projects/Pingusama's Repositories/pingusama-site-mockup-wheel"
  npx create-next-app@latest my-app --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --turbopack --yes
  ```
  Expected: `my-app/` directory created with Next.js 15, Tailwind, App Router.

- [ ] **Step 2: Copy global styles and tokens**

  Replace `my-app/app/globals.css` with the existing token set plus Tailwind directives:
  ```css
  @tailwind base;
  @tailwind components;
  @tailwind utilities;

  :root {
    --bg: #E8DCC4;
    --bg-card: #F4ECD8;
    --bg-card-hi: #FAF3E0;
    --sage: #8FA876;
    --sage-deep: #6E8A57;
    --terracotta: #C97B5C;
    --terracotta-d: #A55E42;
    --dusk: #4F6D7A;
    --gold: #D4A85A;
    --walnut: #3E2C20;
    --walnut-soft: #5C4536;
    --line: #B8A584;
    --font-display: "Fraunces", Georgia, serif;
    --font-body: "Nunito", system-ui, sans-serif;
    --radius: 14px;
    --shadow: 0 2px 0 rgba(62,44,32,.08), 0 8px 24px rgba(62,44,32,.10);
  }
  ```

- [ ] **Step 3: Add fonts to layout**

  In `my-app/app/layout.tsx`:
  ```tsx
  import { Fraunces, Nunito } from 'next/font/google';

  const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-display' });
  const nunito = Nunito({ subsets: ['latin'], variable: '--font-body' });
  ```

- [ ] **Step 4: Recreate landing page components**

  Extract from `index.html`:
  - `components/Header.tsx` — brand + nav links.
  - `components/Footer.tsx` — copyright line.
  - `components/Wheel.tsx` — SVG compass with four tool points.
  - `components/DetailPanel.tsx` — TOOLS data + click-to-lock behavior.
  - `components/Runner.tsx` — 8-frame base64 PNG animation.

  Keep all existing behavior including:
  - click-to-lock panel
  - local tools open directly on click
  - outside click clears lock
  - mobile tap support

- [ ] **Step 5: Build app/page.tsx**

  Assemble `Header`, `Wheel`, `Runner`, `DetailPanel`, `Footer` exactly like the current page.

- [ ] **Step 6: Run dev server and visually verify**

  ```bash
  cd my-app
  npm run dev
  ```
  Open `http://localhost:3000`. Compare to current production site at `https://pingusama-landing.vercel.app`. Wheel, runner, panel, fonts, and colors should match.

- [ ] **Step 7: Capture visual regression screenshots**

  ```bash
  npx playwright test tests/e2e/home.spec.ts
  ```
  (Create `tests/e2e/home.spec.ts` that screenshots homepage at 1280px and 390px.)

- [ ] **Step 8: Commit**

  ```bash
  git add my-app/
  git commit -m "feat(nextjs): scaffold project and migrate landing page"
  ```

---

## Task 2: Set Up Supabase Project and Database Schema

**Files:**
- Create: `my-app/lib/db/schema.sql`, `my-app/lib/db/posts.ts`, `my-app/lib/supabase/client.ts`, `my-app/lib/supabase/server.ts`, `my-app/lib/supabase/middleware.ts`.
- Modify: `my-app/.env.local` (new), `my-app/.env.example`.
- Test: run schema SQL in Supabase SQL Editor; verify table exists.

**Interfaces:**
- Produces: `SupabaseClient` from `lib/supabase/server.ts` with service role for builds.
- Produces: `createClient()` from `lib/supabase/client.ts` for browser.
- Produces: `getSession()` helper used by middleware.

- [ ] **Step 1: Create or reuse Supabase project**

  Use the Supabase dashboard or CLI to create a new project (recommended separate from EPUB tool) or reuse existing. Record `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **Step 2: Write schema SQL**

  In `my-app/lib/db/schema.sql`:
  ```sql
  create table if not exists posts (
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

  create index if not exists idx_posts_search on posts using gin(search_vector);
  create index if not exists idx_posts_status_published on posts(status, published_at desc);
  create index if not exists idx_posts_category on posts(category);
  create index if not exists idx_posts_tags on posts using gin(tags);
  ```

- [ ] **Step 3: Apply schema in Supabase SQL Editor**

  Copy `schema.sql` into the Supabase SQL Editor and run. Verify `posts` table appears.

- [ ] **Step 4: Configure Supabase storage bucket**

  Create bucket `blog-assets` with public access for reading. Upload policy: only authenticated users.

- [ ] **Step 5: Install Supabase dependencies**

  ```bash
  cd my-app
  npm install @supabase/supabase-js @supabase/ssr
  npm install -D supabase
  ```

- [ ] **Step 6: Create server and browser clients**

  `my-app/lib/supabase/server.ts`:
  ```ts
  import { createServerClient } from '@supabase/ssr';
  import { cookies } from 'next/headers';

  export function createClient() {
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { getAll: () => cookies().getAll(), setAll: () => {} } }
    );
  }
  ```

  `my-app/lib/supabase/client.ts`:
  ```ts
  import { createBrowserClient } from '@supabase/ssr';
  export const createClient = () => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  ```

  `my-app/lib/supabase/middleware.ts`:
  ```ts
  import { createServerClient } from '@supabase/ssr';
  import { NextResponse, type NextRequest } from 'next/server';

  export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request });
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies) => cookies.forEach(c => request.cookies.set(c.name, c.value)) } }
    );
    await supabase.auth.getSession();
    return supabaseResponse;
  }
  ```

- [ ] **Step 7: Add environment template**

  `my-app/.env.example`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=
  SUPABASE_SERVICE_ROLE_KEY=
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add my-app/lib/supabase my-app/lib/db/schema.sql my-app/.env.example
  git commit -m "chore(supabase): add schema and clients"
  ```

---

## Task 3: Implement Markdown Parsing and Slug Utilities

**Files:**
- Create: `my-app/lib/markdown.ts`, `my-app/lib/slug.ts`.
- Create tests: `my-app/tests/unit/markdown.test.ts`, `my-app/tests/unit/slug.test.ts`.

**Interfaces:**
- Produces: `parseMarkdown(source: string): { frontmatter: PostFrontmatter, html: string }`.
- Produces: `generateSlug(title: string, existing?: string[]): string`.
- Produces: `truncateExcerpt(text: string, maxLength?: number): string`.

- [ ] **Step 1: Install markdown dependencies**

  ```bash
  cd my-app
  npm install gray-matter remark remark-html remark-gfm rehype-sanitize
  npm install -D @types/...
  ```

- [ ] **Step 2: Write failing test for markdown parsing**

  `my-app/tests/unit/markdown.test.ts`:
  ```ts
  import { test, expect } from 'vitest';
  import { parseMarkdown } from '@/lib/markdown';

  test('parses frontmatter and renders markdown to html', async () => {
    const input = `---\ntitle: Hello\nslug: hello-world\n---\n# Hello\n\nThis is a test.`;
    const result = await parseMarkdown(input);
    expect(result.frontmatter.title).toBe('Hello');
    expect(result.frontmatter.slug).toBe('hello-world');
    expect(result.html).toContain('<h1>Hello</h1>');
    expect(result.html).toContain('<p>This is a test.</p>');
  });
  ```

- [ ] **Step 3: Run failing test**

  ```bash
  npx vitest run tests/unit/markdown.test.ts
  ```
  Expected: FAIL, `parseMarkdown` not defined.

- [ ] **Step 4: Implement markdown parser**

  `my-app/lib/markdown.ts`:
  ```ts
  import matter from 'gray-matter';
  import { remark } from 'remark';
  import remarkHtml from 'remark-html';
  import remarkGfm from 'remark-gfm';
  import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
  import { unified } from 'unified';

  export interface PostFrontmatter {
    title: string;
    slug?: string;
    excerpt?: string;
    category?: string;
    tags?: string[];
    status?: 'draft' | 'published' | 'archived';
    published_at?: string;
    cover_image_url?: string;
    meta_description?: string;
  }

  export async function parseMarkdown(source: string) {
    const { data, content } = matter(source);
    const html = await unified()
      .use(remark)
      .use(remarkGfm)
      .use(remarkHtml, { sanitize: false })
      .use(rehypeSanitize, defaultSchema)
      .process(content);
    return { frontmatter: data as PostFrontmatter, html: String(html) };
  }
  ```

- [ ] **Step 5: Run passing test**

  ```bash
  npx vitest run tests/unit/markdown.test.ts
  ```
  Expected: PASS.

- [ ] **Step 6: Write slug utility tests**

  `my-app/tests/unit/slug.test.ts`:
  ```ts
  import { test, expect } from 'vitest';
  import { generateSlug, sanitizeSlug } from '@/lib/slug';

  test('sanitizeSlug removes unsafe characters', () => {
    expect(sanitizeSlug('Hello World!!!')).toBe('hello-world');
  });

  test('generateSlug avoids duplicates', () => {
    expect(generateSlug('Hello World', ['hello-world'])).toBe('hello-world-1');
  });
  ```

- [ ] **Step 7: Implement slug utility**

  `my-app/lib/slug.ts`:
  ```ts
  export function sanitizeSlug(input: string): string {
    return input
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  export function generateSlug(title: string, existing: string[] = []): string {
    let base = sanitizeSlug(title) || 'untitled';
    let slug = base;
    let i = 1;
    while (existing.includes(slug)) {
      slug = `${base}-${i}`;
      i++;
    }
    return slug;
  }
  ```

- [ ] **Step 8: Run slug tests**

  ```bash
  npx vitest run tests/unit/slug.test.ts
  ```
  Expected: PASS.

- [ ] **Step 9: Commit**

  ```bash
  git add my-app/lib/markdown.ts my-app/lib/slug.ts my-app/tests/unit
  git commit -m "feat(blog): add markdown parsing and slug utilities with tests"
  ```

---

## Task 4: Build Post CRUD Data Layer

**Files:**
- Create: `my-app/lib/db/posts.ts`, `my-app/lib/db/types.ts`.
- Create tests: `my-app/tests/integration/posts.test.ts`.

**Interfaces:**
- Produces: `getPublishedPosts(opts): Promise<Post[]>`.
- Produces: `getPostBySlug(slug): Promise<Post | null>`.
- Produces: `searchPosts(query): Promise<Post[]>`.
- Produces: `savePost(post): Promise<Post>` (insert/update).
- Produces: `deletePost(slug): Promise<void>`.
- Produces: `getCategories()`, `getTags()`.

- [ ] **Step 1: Define Post type**

  `my-app/lib/db/types.ts`:
  ```ts
  export interface Post {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    content_markdown: string;
    content_html: string;
    category: string | null;
    tags: string[] | null;
    status: 'draft' | 'published' | 'archived';
    published_at: string | null;
    updated_at: string;
    created_at: string;
    cover_image_url: string | null;
    meta_description: string | null;
  }
  ```

- [ ] **Step 2: Write data layer**

  `my-app/lib/db/posts.ts`:
  ```ts
  import { createClient } from '@/lib/supabase/server';
  import type { Post } from './types';

  export async function getPublishedPosts({ limit = 10, offset = 0, category, tag }: { limit?: number; offset?: number; category?: string; tag?: string } = {}): Promise<Post[]> {
    const supabase = createClient();
    let query = supabase
      .from('posts')
      .select('*')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (category) query = query.eq('category', category);
    if (tag) query = query.contains('tags', [tag]);
    const { data, error } = await query;
    if (error) throw error;
    return data as Post[];
  }

  export async function getPostBySlug(slug: string): Promise<Post | null> {
    const supabase = createClient();
    const { data, error } = await supabase.from('posts').select('*').eq('slug', slug).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data as Post | null;
  }

  export async function searchPosts(query: string): Promise<Post[]> {
    const supabase = createClient();
    const { data, error } = await supabase
      .rpc('search_posts', { query_text: query })
      .eq('status', 'published');
    if (error) throw error;
    return data as Post[];
  }
  ```

  Add a Postgres function `search_posts`:
  ```sql
  create or replace function search_posts(query_text text)
  returns setof posts language sql stable as $$
    select *
    from posts
    where search_vector @@ plainto_tsquery('english', query_text)
      and status = 'published'
    order by ts_rank_cd(search_vector, plainto_tsquery('english', query_text)) desc;
  $$;
  ```

- [ ] **Step 3: Add save/update/delete helpers**

  In `my-app/lib/db/posts.ts`:
  ```ts
  export async function savePost(post: Partial<Post> & { slug: string; title: string; content_markdown: string; content_html: string }, userId?: string): Promise<Post> {
    const supabase = createClient();
    const payload = { ...post, author_id: userId ?? post.author_id };
    const { data, error } = await supabase.from('posts').upsert(payload, { onConflict: 'slug' }).select().single();
    if (error) throw error;
    return data as Post;
  }

  export async function deletePost(slug: string): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase.from('posts').delete().eq('slug', slug);
    if (error) throw error;
  }
  ```

- [ ] **Step 4: Write integration test against local/test Supabase**

  `my-app/tests/integration/posts.test.ts`:
  ```ts
  import { test, expect, beforeAll } from 'vitest';
  import { getPostBySlug, savePost, deletePost, searchPosts } from '@/lib/db/posts';

  beforeAll(async () => {
    // ensure clean slug
    await deletePost('test-post').catch(() => {});
  });

  test('saves and retrieves a published post', async () => {
    await savePost({ slug: 'test-post', title: 'Test Post', content_markdown: '# Test', content_html: '<h1>Test</h1>', status: 'published' });
    const post = await getPostBySlug('test-post');
    expect(post).not.toBeNull();
    expect(post!.title).toBe('Test Post');
  });
  ```

- [ ] **Step 5: Run integration test**

  ```bash
  npx vitest run tests/integration/posts.test.ts
  ```
  Expected: PASS (requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`).

- [ ] **Step 6: Commit**

  ```bash
  git add my-app/lib/db my-app/tests/integration
  git commit -m "feat(blog): add post CRUD and search data layer"
  ```

---

## Task 5: Build Public Blog Routes

**Files:**
- Create: `my-app/app/blog/page.tsx`, `my-app/app/blog/[slug]/page.tsx`, `my-app/app/blog/category/[category]/page.tsx`, `my-app/app/blog/tag/[tag]/page.tsx`, `my-app/app/blog/search/page.tsx`.
- Create components: `my-app/components/PostCard.tsx`, `my-app/components/Pagination.tsx`, `my-app/components/SearchBox.tsx`, `my-app/components/TagList.tsx`, `my-app/components/PostBody.tsx`.

**Interfaces:**
- Consumes: `getPublishedPosts`, `getPostBySlug`, `searchPosts`, `Post` type.
- Produces: rendered `/blog` pages using shared design tokens.

- [ ] **Step 1: Build PostCard component**

  `my-app/components/PostCard.tsx`:
  ```tsx
  import Link from 'next/link';
  import type { Post } from '@/lib/db/types';

  export function PostCard({ post }: { post: Post }) {
    return (
      <article className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow)]">
        <div className="text-xs uppercase tracking-widest text-[var(--dusk)] mb-1">
          {post.published_at ? new Date(post.published_at).toLocaleDateString() : 'Draft'}
          {post.category && <> · <span className="pill">{post.category}</span></>}
        </div>
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--walnut)] mb-2">
          <Link href={`/blog/${post.slug}`} className="border-none">{post.title}</Link>
        </h2>
        <p className="text-[var(--walnut-soft)]">{post.excerpt}</p>
      </article>
    );
  }
  ```

- [ ] **Step 2: Build /blog page**

  `my-app/app/blog/page.tsx`:
  ```tsx
  import { getPublishedPosts } from '@/lib/db/posts';
  import { PostCard } from '@/components/PostCard';
  import { Pagination } from '@/components/Pagination';

  const PAGE_SIZE = 10;

  export default async function BlogPage({ searchParams }: { searchParams: { page?: string } }) {
    const page = Math.max(1, Number(searchParams.page) || 1);
    const posts = await getPublishedPosts({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    return (
      <main className="wrap py-10">
        <div className="text-center mb-8">
          <p className="eyebrow">from the workshop</p>
          <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold text-[var(--walnut)]">Notes from the workshop</h1>
          <p className="text-[var(--walnut-soft)] mt-2">Short posts about building tools, games, and the occasional rabbit hole.</p>
        </div>
        <div className="flex flex-col gap-4 max-w-2xl mx-auto">
          {posts.map(post => <PostCard key={post.slug} post={post} />)}
        </div>
        <Pagination basePath="/blog" page={page} hasMore={posts.length === PAGE_SIZE} />
      </main>
    );
  }
  ```

- [ ] **Step 3: Build /blog/[slug] page**

  `my-app/app/blog/[slug]/page.tsx`:
  ```tsx
  import { notFound } from 'next/navigation';
  import { getPostBySlug } from '@/lib/db/posts';
  import { PostBody } from '@/components/PostBody';
  import { TagList } from '@/components/TagList';
  import type { Metadata } from 'next';

  export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
    const post = await getPostBySlug(params.slug);
    return { title: post?.title ?? 'Post not found', description: post?.meta_description ?? post?.excerpt ?? '' };
  }

  export const revalidate = 60;

  export default async function PostPage({ params }: { params: { slug: string } }) {
    const post = await getPostBySlug(params.slug);
    if (!post || post.status !== 'published') notFound();
    return (
      <article className="wrap py-10 max-w-2xl">
        <div className="mb-2 text-xs uppercase tracking-widest text-[var(--dusk)]">
          {new Date(post.published_at!).toLocaleDateString()}
          {post.category && <> · <span className="pill">{post.category}</span></>}
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold text-[var(--walnut)] mb-4">{post.title}</h1>
        {post.cover_image_url && <img src={post.cover_image_url} alt={post.title} className="rounded-[var(--radius)] mb-6" />}
        <PostBody html={post.content_html} />
        {post.tags && <TagList tags={post.tags} className="mt-8" />}
      </article>
    );
  }
  ```

- [ ] **Step 4: Build PostBody and TagList components**

  `my-app/components/PostBody.tsx`:
  ```tsx
  export function PostBody({ html }: { html: string }) {
    return <div className="prose prose-stone max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  ```

  Add `@tailwindcss/typography` plugin for `.prose`.

  `my-app/components/TagList.tsx`:
  ```tsx
  import Link from 'next/link';
  export function TagList({ tags }: { tags: string[] }) {
    return (
      <div className="flex flex-wrap gap-2">
        {tags.map(tag => (
          <Link key={tag} href={`/blog/tag/${encodeURIComponent(tag)}`} className="pill border-none">{tag}</Link>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 5: Build category and tag archive pages**

  `my-app/app/blog/category/[category]/page.tsx` and `my-app/app/blog/tag/[tag]/page.tsx` mirror `/blog` but call `getPublishedPosts({ category })` or `getPublishedPosts({ tag })`.

- [ ] **Step 6: Build search page**

  `my-app/app/blog/search/page.tsx`:
  ```tsx
  import { searchPosts } from '@/lib/db/posts';
  import { PostCard } from '@/components/PostCard';
  import { SearchBox } from '@/components/SearchBox';

  export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
    const posts = searchParams.q ? await searchPosts(searchParams.q) : [];
    return (
      <main className="wrap py-10 max-w-2xl mx-auto">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--walnut)] mb-4">Search</h1>
        <SearchBox initialQuery={searchParams.q} />
        {posts.length === 0 && searchParams.q ? <p className="text-[var(--walnut-soft)]">No posts found.</p> : null}
        <div className="flex flex-col gap-4 mt-6">
          {posts.map(post => <PostCard key={post.slug} post={post} />)}
        </div>
      </main>
    );
  }
  ```

- [ ] **Step 7: Add prose plugin and run dev server**

  ```bash
  cd my-app
  npm install -D @tailwindcss/typography
  ```

  Update `my-app/tailwind.config.ts` to include the typography plugin.

- [ ] **Step 8: Visual regression for blog pages**

  Add Playwright tests that visit `/blog`, `/blog/[slug]`, `/blog/search?q=test` and capture screenshots.

- [ ] **Step 9: Commit**

  ```bash
  git add my-app/app/blog my-app/components
  git commit -m "feat(blog): add public blog routes and components"
  ```

---

## Task 6: Add RSS Feed and Sitemap

**Files:**
- Create: `my-app/app/feed.xml/route.ts`, `my-app/app/sitemap.xml/route.ts`.

**Interfaces:**
- Consumes: `getPublishedPosts`.
- Produces: valid XML on `/feed.xml` and `/sitemap.xml`.

- [ ] **Step 1: Build RSS route**

  `my-app/app/feed.xml/route.ts`:
  ```ts
  import { getPublishedPosts } from '@/lib/db/posts';
  import { NextResponse } from 'next/server';

  export async function GET() {
    const posts = await getPublishedPosts({ limit: 20 });
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pingusama-landing.vercel.app';
    const items = posts.map(p => `
      <item>
        <title>${escapeXml(p.title)}</title>
        <link>${siteUrl}/blog/${p.slug}</link>
        <description>${escapeXml(p.excerpt ?? '')}</description>
        <pubDate>${new Date(p.published_at!).toUTCString()}</pubDate>
        <guid>${siteUrl}/blog/${p.slug}</guid>
      </item>
    `).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <title>Pingusama's Workshop</title>
      <link>${siteUrl}</link>
      <description>Notes from the workshop.</description>
      ${items}
    </channel></rss>`;
    return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } });
  }

  function escapeXml(str: string) {
    return str.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;'}[c]!));
  }
  ```

- [ ] **Step 2: Build sitemap route**

  `my-app/app/sitemap.xml/route.ts`:
  ```ts
  import { getPublishedPosts } from '@/lib/db/posts';

  export async function GET() {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pingusama-landing.vercel.app';
    const posts = await getPublishedPosts({ limit: 1000 });
    const urls = [
      { loc: siteUrl, lastmod: new Date().toISOString() },
      { loc: `${siteUrl}/blog`, lastmod: new Date().toISOString() },
      ...posts.map(p => ({ loc: `${siteUrl}/blog/${p.slug}`, lastmod: p.updated_at })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${urls.map(u => `<url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('')}
    </urlset>`;
    return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } });
  }
  ```

- [ ] **Step 3: Test routes**

  ```bash
  curl http://localhost:3000/feed.xml
  curl http://localhost:3000/sitemap.xml
  ```
  Expected: valid XML containing published posts.

- [ ] **Step 4: Commit**

  ```bash
  git add my-app/app/feed.xml my-app/app/sitemap.xml
  git commit -m "feat(blog): add RSS feed and sitemap"
  ```

---

## Task 7: Build Admin Authentication and Middleware

**Files:**
- Create: `my-app/middleware.ts`, `my-app/app/admin/login/page.tsx`, `my-app/lib/auth.ts`.
- Modify: `my-app/app/layout.tsx` (wrap with Supabase provider if needed for client auth).

**Interfaces:**
- Produces: `requireAdmin(request)` middleware helper.
- Produces: login form that sends magic link.

- [ ] **Step 1: Add middleware**

  `my-app/middleware.ts`:
  ```ts
  import { updateSession } from '@/lib/supabase/middleware';
  import { createServerClient } from '@supabase/ssr';
  import { NextResponse } from 'next/server';
  import type { NextRequest } from 'next/server';

  export async function middleware(request: NextRequest) {
    const response = await updateSession(request);
    if (request.nextUrl.pathname.startsWith('/admin')) {
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} } }
      );
      const { data: { session } } = await supabase.auth.getSession();
      const isAdmin = session?.user.app_metadata?.role === 'admin';
      if (!isAdmin && request.nextUrl.pathname !== '/admin/login') {
        return NextResponse.redirect(new URL('/admin/login', request.url));
      }
    }
    return response;
  }

  export const config = { matcher: ['/admin/:path*'] };
  ```

- [ ] **Step 2: Build login page**

  `my-app/app/admin/login/page.tsx`:
  ```tsx
  'use client';
  import { useState } from 'react';
  import { createClient } from '@/lib/supabase/client';

  export default function AdminLoginPage() {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const supabase = createClient();
    return (
      <main className="wrap py-20 max-w-md mx-auto text-center">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--walnut)] mb-4">Admin login</h1>
        {sent ? <p className="text-[var(--walnut-soft)]">Magic link sent. Check your email.</p> : (
          <form onSubmit={async e => { e.preventDefault(); await supabase.auth.signInWithOtp({ email }); setSent(true); }} className="flex flex-col gap-4">
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="mock-input" />
            <button type="submit" className="mock-button">Send magic link</button>
          </form>
        )}
      </main>
    );
  }
  ```

- [ ] **Step 3: Add admin role assignment helper**

  `my-app/lib/auth.ts`:
  ```ts
  export function isAdmin(user: { app_metadata?: { role?: string } } | null) {
    return user?.app_metadata?.role === 'admin';
  }
  ```

- [ ] **Step 4: Manually set admin role in Supabase**

  In Supabase Auth dashboard, set the first user's `app_metadata` to `{ "role": "admin" }`.

- [ ] **Step 5: Test middleware**

  Visit `http://localhost:3000/admin/blog` while logged out. Expected: redirect to `/admin/login`.

- [ ] **Step 6: Commit**

  ```bash
  git add my-app/middleware.ts my-app/app/admin/login my-app/lib/auth.ts
  git commit -m "feat(admin): add auth middleware and magic-link login"
  ```

---

## Task 8: Build Admin Dashboard and Editor

**Files:**
- Create: `my-app/app/admin/blog/page.tsx`, `my-app/app/admin/blog/new/page.tsx`, `my-app/app/admin/blog/edit/[slug]/page.tsx`, `my-app/components/AdminPostTable.tsx`, `my-app/components/MarkdownEditor.tsx`.
- Create API route: `my-app/app/api/posts/route.ts`.

**Interfaces:**
- Consumes: `getPublishedPosts`, `getPostBySlug`, `savePost`, `deletePost`.
- Produces: full CRUD UI for posts.

- [ ] **Step 1: Build API route for posts**

  `my-app/app/api/posts/route.ts`:
  ```ts
  import { NextResponse } from 'next/server';
  import { savePost, deletePost } from '@/lib/db/posts';
  import { parseMarkdown } from '@/lib/markdown';

  export async function POST(request: Request) {
    const body = await request.json();
    const html = body.content_html ?? (await parseMarkdown(body.content_markdown)).html;
    const post = await savePost({ ...body, content_html: html });
    return NextResponse.json(post);
  }

  export async function DELETE(request: Request) {
    const { slug } = await request.json();
    await deletePost(slug);
    return NextResponse.json({ ok: true });
  }
  ```

- [ ] **Step 2: Build MarkdownEditor component**

  `my-app/components/MarkdownEditor.tsx`:
  ```tsx
  'use client';
  import { useState } from 'react';
  import { PostBody } from './PostBody';

  export function MarkdownEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-96">
        <textarea value={value} onChange={e => onChange(e.target.value)} className="w-full h-full p-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)] font-mono text-sm" />
        <div className="h-full overflow-auto p-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card)]">
          <PostBody html={/* server-rendered preview would need separate API; for now render plain text placeholder */ value} />
        </div>
      </div>
    );
  }
  ```

  Note: live preview needs HTML rendering. Add a client-side `parseMarkdown` wrapper or call `/api/preview`.

- [ ] **Step 3: Build admin dashboard**

  `my-app/app/admin/blog/page.tsx`:
  ```tsx
  import { getPublishedPosts } from '@/lib/db/posts';
  import { AdminPostTable } from '@/components/AdminPostTable';
  import Link from 'next/link';

  export default async function AdminDashboardPage() {
    const posts = await getPublishedPosts({ limit: 100 });
    return (
      <main className="wrap py-10">
        <div className="flex justify-between items-center mb-6">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--walnut)]">Posts</h1>
          <Link href="/admin/blog/new" className="mock-button">New post</Link>
        </div>
        <AdminPostTable posts={posts} />
      </main>
    );
  }
  ```

- [ ] **Step 4: Build editor pages**

  `my-app/app/admin/blog/new/page.tsx` and `my-app/app/admin/blog/edit/[slug]/page.tsx` share a form component. Fields: title, slug, excerpt, category, tags, cover_image_url, status, published_at, content_markdown.

- [ ] **Step 5: Test full admin flow**

  Playwright E2E: login → create post → publish → view on `/blog`.

- [ ] **Step 6: Commit**

  ```bash
  git add my-app/app/admin my-app/app/api/posts my-app/components/AdminPostTable.tsx my-app/components/MarkdownEditor.tsx
  git commit -m "feat(admin): add dashboard and markdown editor"
  ```

---

## Task 9: Add Drag-and-Drop File Import

**Files:**
- Create: `my-app/app/api/import/route.ts`.
- Modify: `my-app/components/MarkdownEditor.tsx` or create `my-app/components/FileDropZone.tsx`.

**Interfaces:**
- Consumes: `parseMarkdown`.
- Produces: parsed post fields returned to editor.

- [ ] **Step 1: Install file parsers**

  ```bash
  cd my-app
  npm install mammoth
  ```

- [ ] **Step 2: Build import API route**

  `my-app/app/api/import/route.ts`:
  ```ts
  import { NextResponse } from 'next/server';
  import { parseMarkdown } from '@/lib/markdown';
  import mammoth from 'mammoth';

  export async function POST(request: Request) {
    const form = await request.formData();
    const file = form.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split('.').pop()?.toLowerCase();
    try {
      let title = '';
      let markdown = '';
      if (ext === 'md') {
        const parsed = await parseMarkdown(buffer.toString('utf-8'));
        return NextResponse.json(parsed.frontmatter);
      }
      if (ext === 'txt') {
        markdown = buffer.toString('utf-8');
        title = markdown.split('\n')[0].replace(/^#+\s*/, '');
      }
      if (ext === 'docx') {
        const result = await mammoth.extractRawText({ buffer });
        markdown = result.value;
        title = markdown.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '') ?? '';
      }
      return NextResponse.json({ title, content_markdown: markdown });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 422 });
    }
  }
  ```

- [ ] **Step 3: Add drop zone to editor**

  `my-app/components/FileDropZone.tsx`:
  ```tsx
  'use client';
  import { useCallback } from 'react';

  export function FileDropZone({ onImported }: { onImported: (data: any) => void }) {
    const onDrop = useCallback(async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/import', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok) onImported(data);
      else alert(data.error);
    }, [onImported]);

    return (
      <div onDrop={onDrop} onDragOver={e => e.preventDefault()} className="border-2 border-dashed border-[var(--line)] rounded-[var(--radius)] p-6 text-center text-[var(--walnut-soft)]">
        Drop .md, .txt, or .docx here to import
      </div>
    );
  }
  ```

- [ ] **Step 4: Test import for each file type**

  Add integration tests in `my-app/tests/integration/import.test.ts`.

- [ ] **Step 5: Commit**

  ```bash
  git add my-app/app/api/import my-app/components/FileDropZone.tsx
  git commit -m "feat(admin): add drag-and-drop file import for md, txt, docx"
  ```

---

## Task 10: Add Git-Pushed Markdown Import Script

**Files:**
- Create: `my-app/scripts/import-posts.ts`, `content/posts/example-post.md`.
- Modify: `my-app/package.json` scripts.

**Interfaces:**
- Consumes: `parseMarkdown`, `savePost`.
- Produces: upserts posts in Supabase from `content/posts/*.md`.

- [ ] **Step 1: Create example post**

  `content/posts/example-post.md`:
  ```markdown
  ---
  title: Why I built a 簡繁 converter
  slug: why-sim2trad
  excerpt: Reading web novels in Traditional Chinese shouldn't require Calibre archaeology.
  category: tools
  tags: ["chinese", "epub", "tools"]
  status: published
  published_at: 2026-06-28
  ---

  Reading web novels in Traditional Chinese shouldn't require Calibre archaeology. Here's how I built a converter that handles giant novels and keeps the table of contents intact.
  ```

- [ ] **Step 2: Write import script**

  `my-app/scripts/import-posts.ts`:
  ```ts
  import { readdir, readFile } from 'fs/promises';
  import { join } from 'path';
  import { parseMarkdown } from '@/lib/markdown';
  import { savePost } from '@/lib/db/posts';

  async function run() {
    const dir = join(process.cwd(), '..', 'content', 'posts');
    const files = (await readdir(dir)).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const source = await readFile(join(dir, file), 'utf-8');
      const { frontmatter, html } = await parseMarkdown(source);
      await savePost({
        slug: frontmatter.slug || 'untitled',
        title: frontmatter.title || 'Untitled',
        excerpt: frontmatter.excerpt || null,
        category: frontmatter.category || null,
        tags: frontmatter.tags || null,
        status: frontmatter.status || 'draft',
        published_at: frontmatter.published_at || null,
        cover_image_url: frontmatter.cover_image_url || null,
        meta_description: frontmatter.meta_description || null,
        content_markdown: source,
        content_html: html,
      });
      console.log('imported', frontmatter.slug);
    }
  }

  run().catch(console.error);
  ```

- [ ] **Step 3: Add package script**

  In `my-app/package.json`:
  ```json
  {
    "scripts": {
      "import-posts": "tsx scripts/import-posts.ts"
    }
  }
  ```

  Install `tsx`:
  ```bash
  npm install -D tsx
  ```

- [ ] **Step 4: Run import script**

  ```bash
  cd my-app
  npm run import-posts
  ```
  Expected: example post imported into Supabase.

- [ ] **Step 5: Commit**

  ```bash
  git add my-app/scripts my-app/package.json content/posts
  git commit -m "feat(blog): add git-pushed markdown import script"
  ```

---

## Task 11: Configure Vercel Deploy and Replace Old `index.html`

**Files:**
- Modify: `my-app/next.config.js`, root `vercel.json`, root `package.json`, root `.gitignore`.
- Delete: root `index.html` (after Next.js site is verified). Keep in git history.

**Interfaces:**
- Produces: Next.js app deployed at `pingusama-landing.vercel.app`.

- [ ] **Step 1: Configure Next.js for static + dynamic routes**

  `my-app/next.config.js`:
  ```js
  /** @type {import('next').NextConfig} */
  const nextConfig = {
    output: 'standalone',
    images: { unoptimized: true },
  };
  module.exports = nextConfig;
  ```

- [ ] **Step 2: Move Next.js app to repo root**

  Option A: keep `my-app/` as the project root and set Vercel root directory to `my-app`.
  Option B: move all `my-app/` contents to repo root and delete `my-app/` folder.
  **Recommended:** Option A (set Vercel root directory to `my-app`). It keeps the old `index.html` and tooling available during transition.

- [ ] **Step 3: Update Vercel project root directory**

  In Vercel dashboard or via CLI:
  ```bash
  vercel --cwd my-app
  ```
  Link existing `pingusama-landing` project with root directory `my-app`.

- [ ] **Step 4: Add build env vars**

  In Vercel project settings, add:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `NEXT_PUBLIC_SITE_URL=https://pingusama-landing.vercel.app`

- [ ] **Step 5: Deploy**

  ```bash
  cd my-app
  vercel --prod
  ```
  Verify homepage matches old site, blog index shows imported post, `/blog/why-sim2trad` renders, `/feed.xml` works.

- [ ] **Step 6: Update root README or HANDOFF**

  Note new architecture and how to run/import posts.

- [ ] **Step 7: Commit**

  ```bash
  git add my-app/next.config.js vercel.json
  git commit -m "chore(deploy): configure Vercel root directory and Next.js standalone build"
  ```

---

## Task 12: Final Testing and Visual Regression

**Files:**
- Create/update: Playwright tests under `my-app/tests/e2e/`.

**Interfaces:**
- Produces: passing E2E suite covering homepage, blog, admin, search, RSS.

- [ ] **Step 1: Install Playwright**

  ```bash
  cd my-app
  npm install -D @playwright/test
  npx playwright install chromium
  ```

- [ ] **Step 2: Write E2E tests**

  `my-app/tests/e2e/blog.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test';

  test('blog index loads', async ({ page }) => {
    await page.goto('/blog');
    await expect(page).toHaveTitle(/Notes from the workshop/);
  });

  test('published post renders', async ({ page }) => {
    await page.goto('/blog/why-sim2trad');
    await expect(page.locator('h1')).toContainText('Why I built');
  });

  test('search finds a post', async ({ page }) => {
    await page.goto('/blog/search?q=converter');
    await expect(page.locator('article')).toHaveCount.greaterThan(0);
  });

  test('rss feed contains posts', async ({ request }) => {
    const feed = await request.get('/feed.xml');
    expect(await feed.text()).toContain('<item>');
  });
  ```

- [ ] **Step 3: Run E2E suite**

  ```bash
  npx playwright test
  ```
  Expected: all tests pass.

- [ ] **Step 4: Capture visual regression screenshots**

  Add a test that screenshots homepage, `/blog`, and a post page at desktop and mobile widths.

- [ ] **Step 5: Commit**

  ```bash
  git add my-app/tests/e2e
  git commit -m "test(blog): add e2e coverage for blog and rss"
  ```

---

## Spec Coverage Checklist

| Spec Section | Implementing Task |
|---|---|
| Next.js 15 App Router | Task 1 |
| Tailwind + existing tokens | Task 1 |
| Supabase Postgres + schema | Task 2 |
| Supabase Auth + admin middleware | Task 7 |
| Supabase Storage | Task 2 (bucket config), Task 8 (cover upload optional) |
| Markdown rendering | Task 3 |
| Full-text search | Task 4, Task 5 |
| RSS / sitemap | Task 6 |
| Public blog routes | Task 5 |
| Admin dashboard + editor | Task 8 |
| Drag-and-drop import | Task 9 |
| Git-pushed markdown import | Task 10 |
| Design system reuse | Task 1, Task 5 |
| Error handling | Task 2 (RLS), Task 7 (auth), Task 8 (slug validation), Task 9 (parse errors) |
| Testing | Task 3, Task 4, Task 12 |
| Migration / deploy | Task 11 |

---

## Open Issues / Notes

- Live markdown preview in the editor may need a separate `/api/preview` endpoint or client-side parsing. If adding `rehype-sanitize` client-side is too heavy, call `/api/posts/preview` that returns rendered HTML.
- The `my-app/` directory is intentionally nested. Vercel root directory should be set to `my-app` for the first deploy, then optionally flattened later.
- Old `index.html` should remain in the repo until the Next.js site is verified live, at which point it can be deleted in a follow-up commit.
