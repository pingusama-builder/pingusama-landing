// Apply RLS to public.posts via the Supabase Management API.
// Reads SUPABASE_ACCESS_TOKEN from .env.local (never prints it).
// Run: npx tsx scripts/apply-rls.ts
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
console.log(`token present: ${token.length > 0} (len ${token.length}, prefix ${token.slice(0, 4)}…)`);

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
  // 1. connectivity test
  const ok = await runSql("SELECT 1 AS probe;", "connectivity SELECT 1");
  if (!ok) {
    console.error("connectivity failed — check token / endpoint. Aborting.");
    process.exit(1);
  }

  // 2. apply RLS
  await runSql("ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;", "enable RLS");
  await runSql('DROP POLICY IF EXISTS "Public read published posts" ON public.posts;', "drop old policy");
  await runSql(
    `CREATE POLICY "Public read published posts"
       ON public.posts
       FOR SELECT
       TO anon, authenticated
       USING (status = 'published');`,
    "create read policy",
  );

  // 3. confirm
  await runSql(
    `SELECT relrowsecurity AS rls_on,
            (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='posts') AS policy_count
       FROM pg_class WHERE relname='posts';`,
    "verify state",
  );
}

main().catch(e => { console.error("fatal:", e); process.exit(1); });