// Apply the public.tinker_entries migration (燈工房 trove, Supabase-backed
// mirror of posts) to prod Supabase via the Management API. Reads
// SUPABASE_ACCESS_TOKEN from .env.local (never prints it). Idempotent — every
// statement is IF NOT EXISTS / ON CONFLICT. Also seeds the first entry (Q7)
// so the trove is not empty after migration.
// Run: npx tsx scripts/apply-tinker-entries.ts
import * as fs from "node:fs";
import * as path from "node:path";

const envFile = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const env: Record<string, string> = {};
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const token = env.SUPABASE_ACCESS_TOKEN;
const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL!;
const ref = supaUrl.replace(/^https:\/\//, "").split(".")[0];

if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN not found in .env.local");
  process.exit(1);
}
console.log(`project ref: ${ref}`);
console.log(`token present: len ${token.length} (prefix ${token.slice(0, 4)}…)`);

const API = `https://api.supabase.com/v1/projects/${ref}/database/query`;

async function runSql(query: string, label: string) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  console.log(`[${label}] HTTP ${res.status}`);
  if (!res.ok) {
    console.log(`  response: ${typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500)}`);
  } else {
    console.log(`  ok${body ? " · " + (typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)) : ""}`);
  }
  return res.ok;
}

async function main() {
  const ok = await runSql("SELECT 1 AS probe;", "connectivity SELECT 1");
  if (!ok) {
    console.error("connectivity failed — check token / endpoint. Aborting.");
    process.exit(1);
  }

  await runSql(
    `CREATE TABLE IF NOT EXISTS public.tinker_entries (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       slug text UNIQUE NOT NULL,
       topic text NOT NULL,
       project text,
       harness text,
       prompt text NOT NULL,
       source jsonb,
       status text NOT NULL DEFAULT 'published',
       sort_order int NOT NULL DEFAULT 0,
       updated_at timestamptz DEFAULT now(),
       created_at timestamptz DEFAULT now()
     );`,
    "create tinker_entries",
  );
  await runSql(
    `CREATE INDEX IF NOT EXISTS idx_tinker_entries_status_sort
       ON public.tinker_entries (status, sort_order, created_at DESC);`,
    "create status/sort index",
  );
  await runSql(
    "ALTER TABLE public.tinker_entries ENABLE ROW LEVEL SECURITY;",
    "enable RLS",
  );
  await runSql(
    `DROP POLICY IF EXISTS "Public read published tinker entries" ON public.tinker_entries;
     CREATE POLICY "Public read published tinker entries"
       ON public.tinker_entries
       FOR SELECT TO anon, authenticated
       USING (status = 'published');`,
    "create public-read-published policy",
  );

  // Seed the first entry (Q7) — the trove's type specimen. ON CONFLICT keeps
  // it idempotent: re-running never clobbers an admin-edited row.
  await runSql(
    `INSERT INTO public.tinker_entries (slug, topic, project, harness, prompt, source, status, sort_order)
     VALUES (
       'q7-unity-redesign',
       'unity 重新設計 — embedding = unity-generation + 層遞級 + mirror flow',
       '迥念-Reminiscent',
       'glm 5.2 cloud · Claude Code via Ollama',
       '我認為一個可行方向：上傳文本後後台自動 embedding，但 embedding 可能要用生成 unity 既方式去做，唔係一般文本 embedding；另外生成 unity 應該有層遞級，每章 → 人物性格-動機-發展/主線-暗線/大環境/機制（如門派、道法、修行等）。如要生成能真正映照引文的 unity，12000 token 不能憑空對整本小說生成，要先解讀引文，然後配對之前 embedding 已做主題/人物工夫，先有可能做出 quality 映照。',
       jsonb_build_object(
         'label', 'unity-concept-session-transcript.md · Q7（第 96 行）',
         'path', 'D:\\Codex projects\\迥念-Reminiscent\\.scratch\\unity-concept-session-transcript.md',
         'note', 'unity 概念思考 session 嘅逐字 Q&A 重組。同場：A7 confirm embedding=generation 爲最大 lever ＋ 補 C 氛圍質地／D 未解之勢兩個守衛位。'
       ),
       'published',
       0
     )
     ON CONFLICT (slug) DO NOTHING;`,
    "seed Q7 entry",
  );

  await runSql(
    `SELECT c.relrowsecurity AS rls_on,
            (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='tinker_entries') AS idx_count,
            (SELECT count(*) FROM public.tinker_entries) AS row_count
       FROM pg_class c WHERE c.relname='tinker_entries';`,
    "verify state",
  );
}

main().catch(e => { console.error("fatal:", e); process.exit(1); });