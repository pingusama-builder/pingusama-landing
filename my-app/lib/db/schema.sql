-- Idempotent Supabase blog backend schema

-- 1. Enable pgcrypto so gen_random_uuid() is available
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Posts table
CREATE TABLE IF NOT EXISTS public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  excerpt text,
  content_markdown text NOT NULL,
  content_html text NOT NULL,
  category text,
  tags text[],
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cover_image_url text,
  meta_description text,
  search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(content_markdown, '')), 'C')
    ) STORED
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON public.posts USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_posts_status_published_at ON public.posts (status, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_posts_category ON public.posts (category);
CREATE INDEX IF NOT EXISTS idx_posts_tags ON public.posts USING GIN (tags);

-- 3b. Row-Level Security on posts
-- The app reads/writes posts ONLY through the service-role key (lib/db/posts.ts),
-- which bypasses RLS. Anon/authenticated clients never touch this table directly,
-- so we lock it down: public can read published posts, nobody (anon/auth) can write.
-- All writes happen via the service role, which is unaffected.
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published posts" ON public.posts;
CREATE POLICY "Public read published posts"
  ON public.posts
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

-- No INSERT/UPDATE/DELETE policies for anon/authenticated: writes are
-- service-role only. This is what closes the "publicly accessible table" hole.

-- 4. Search function
CREATE OR REPLACE FUNCTION public.search_posts(query_text text)
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM public.posts
  WHERE status = 'published'
    AND search_vector @@ plainto_tsquery('english', query_text)
  ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', query_text)) DESC;
$$;

-- 5. Storage bucket for blog assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('blog-assets', 'blog-assets', true)
ON CONFLICT (id) DO NOTHING;

-- 6. Storage policies (idempotent)
DO $$
BEGIN
  -- Public read for anon
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Public read access for blog-assets'
  ) THEN
    CREATE POLICY "Public read access for blog-assets"
      ON storage.objects
      FOR SELECT
      TO anon, authenticated
      USING (bucket_id = 'blog-assets');
  END IF;

  -- Authenticated upload
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated upload for blog-assets'
  ) THEN
    CREATE POLICY "Authenticated upload for blog-assets"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'blog-assets');
  END IF;

  -- Authenticated update
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated update for blog-assets'
  ) THEN
    CREATE POLICY "Authenticated update for blog-assets"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (bucket_id = 'blog-assets')
      WITH CHECK (bucket_id = 'blog-assets');
  END IF;

  -- Authenticated delete
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated delete for blog-assets'
  ) THEN
    CREATE POLICY "Authenticated delete for blog-assets"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = 'blog-assets');
  END IF;
END $$;

-- 7. Bench config (shelf + vault as JSON). Service-role only; no public RLS policies.
CREATE TABLE IF NOT EXISTS public.bench (
  key text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.bench ENABLE ROW LEVEL SECURITY;

-- 8. Book metadata + mirrored cover pointers. Service-role only (like bench).
CREATE TABLE IF NOT EXISTS public.books (
  isbn13           text PRIMARY KEY,
  google_books_id  text,
  title            text NOT NULL,
  subtitle         text,
  authors          text[] NOT NULL DEFAULT '{}',
  publisher        text,
  published_date   text,
  page_count       int,
  info_link        text,
  isbn10           text,
  cover_url        text,
  cover_source     text,
  has_cover        boolean NOT NULL DEFAULT false,
  last_fetched_at  timestamptz,
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;

-- 9. Storage bucket for mirrored book covers. Public read (browser <img>),
-- authenticated writes (admin warming path).
INSERT INTO storage.buckets (id, name, public)
VALUES ('covers', 'covers', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Public read access for covers'
  ) THEN
    CREATE POLICY "Public read access for covers"
      ON storage.objects
      FOR SELECT
      TO anon, authenticated
      USING (bucket_id = 'covers');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated upload for covers'
  ) THEN
    CREATE POLICY "Authenticated upload for covers"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'covers');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated update for covers'
  ) THEN
    CREATE POLICY "Authenticated update for covers"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (bucket_id = 'covers')
      WITH CHECK (bucket_id = 'covers');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated delete for covers'
  ) THEN
    CREATE POLICY "Authenticated delete for covers"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = 'covers');
  END IF;
END $$;

-- =====================================================
-- 10. Site-aware chatbot — memory + conversation store
-- Service-role only (like bench/books); the bot reads/writes these
-- server-side. NO public RLS policies. The bot's tool surface is
-- strictly scoped to these tables; it can never touch posts/books/
-- bench/storage (those write functions are never imported in the
-- chat code path), so prompt injection cannot mutate the public site.
-- =====================================================

-- Conversation threads (resumable, reviewable; admin-only audience).
CREATE TABLE IF NOT EXISTS public.chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;

-- Messages within a thread (role: user | assistant | tool).
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text,
  tool_calls jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON public.chat_messages (thread_id, created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Model visibility + control (companion feature 3/3) — additive.
ALTER TABLE public.chat_threads ADD COLUMN IF NOT EXISTS model_preference text;
ALTER TABLE public.chat_threads ADD COLUMN IF NOT EXISTS one_turn_override text;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS model text;

-- Memory bank — the bot's own durable, self-refining scratchpad.
-- Mirrors Claude Code's memory system: one record per durable fact,
-- types (user/feedback/project/reference/idea), plus a `site` type for
-- auto-maintained per-category awareness (site:blog, site:shelf, ...).
-- `embedding` is intentionally NOT added yet (deferred to a future pgvector
-- migration) so the pilot deploys without requiring the vector extension;
-- recallMemories() loads all active rows now and swaps to filtered/semantic
-- later without changing callers.
CREATE TABLE IF NOT EXISTS public.chat_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('user','feedback','project','reference','idea','site')),
  name text NOT NULL,
  description text NOT NULL,
  content text NOT NULL,
  links text[] NOT NULL DEFAULT '{}',
  source_thread_id uuid REFERENCES public.chat_threads(id) ON DELETE SET NULL,
  fingerprint text,
  last_used_at timestamptz DEFAULT now(),
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

-- Unique among active memories (soft-deleted rows don't collide).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_chat_memories_active_name
  ON public.chat_memories (name) WHERE active = true;

-- Fast recall: active rows, most-recently-used first.
CREATE INDEX IF NOT EXISTS idx_chat_memories_active_used
  ON public.chat_memories (active, last_used_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_memories_type
  ON public.chat_memories (type) WHERE active = true;

ALTER TABLE public.chat_memories ENABLE ROW LEVEL SECURITY;

-- No INSERT/UPDATE/DELETE/SELECT policies for anon/authenticated:
-- all access is service-role only (lib/db/chat.ts), which bypasses RLS.
-- This is what keeps the memory bank (and thus the bot) off the public surface.
