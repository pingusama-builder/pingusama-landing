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
