-- Site-aware chatbot schema (idempotent, additive).
-- Service-role only; no public RLS policies. The bot's writes are confined
-- to these tables — it can never reach posts/books/bench/storage.

CREATE TABLE IF NOT EXISTS public.chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;

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
CREATE UNIQUE INDEX IF NOT EXISTS uniq_chat_memories_active_name
  ON public.chat_memories (name) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_chat_memories_active_used
  ON public.chat_memories (active, last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_memories_type
  ON public.chat_memories (type) WHERE active = true;
ALTER TABLE public.chat_memories ENABLE ROW LEVEL SECURITY;