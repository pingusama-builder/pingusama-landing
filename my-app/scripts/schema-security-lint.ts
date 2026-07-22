// Supabase schema security lint — probes the two recurring WARN findings:
//   1. function_search_path_mutable  (public-schema / security-definer fn with no pinned search_path)
//   2. public_bucket_allows_listing  (FOR SELECT policy on storage.objects for a public=true bucket)
//
// Read-only — runs SELECTs only, applies no fixes. Reads SUPABASE_ACCESS_TOKEN
// from .env.local (never prints it). Run: npx tsx scripts/schema-security-lint.ts
//
// Fix loop lives in the `supabase-schema-security-lint` skill.
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
if (!token) { console.error("SUPABASE_ACCESS_TOKEN not found in .env.local"); process.exit(1); }

const API = `https://api.supabase.com/v1/projects/${ref}/database/query`;

async function runSql<T = any>(query: string): Promise<T[]> {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`SQL HTTP ${res.status}: ${text.slice(0, 500)}`);
    throw new Error(`query failed: ${query.slice(0, 80)}`);
  }
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  // Management API returns rows either as a bare array or { rows: [...] } / array-of-arrays.
  let rows: any[] = [];
  if (Array.isArray(body)) rows = body;
  else if (Array.isArray(body?.rows)) rows = body.rows;
  else if (Array.isArray(body?.data)) rows = body.data;
  return rows as T[];
}

type FnRow = { proname: string; args: string; proconfig: string[] | null; prosecdef: boolean };
type PolRow = { policyname: string; cmd: string; roles: string[]; using_expr: string | null; with_check: string | null };
type BucketRow = { id: string; name: string; public: boolean };

async function main() {
  console.log(`project ref: ${ref}`);
  await runSql("SELECT 1 AS probe;");
  console.log("connectivity: ok\n");

  // ---- Finding 1: function_search_path_mutable ----
  // Public-schema functions OR security-definer functions whose proconfig has
  // no `search_path=` entry. (pg_catalog is implicitly searched first regardless.)
  const fns = await runSql<FnRow>(`
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.proconfig,
           p.prosecdef
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prokind = 'f'
       AND (n.nspname = 'public' OR p.prosecdef = true)
     ORDER BY n.nspname, p.proname;
  `);

  const mutable = fns.filter((f) => {
    const cfg = f.proconfig ?? [];
    return !cfg.some((c) => /^\s*search_path\s*=/i.test(c));
  });

  console.log(`=== function_search_path_mutable ===`);
  console.log(`public-schema + security-definer functions scanned: ${fns.length}`);
  console.log(`flagged (no pinned search_path): ${mutable.length}`);
  for (const f of mutable) {
    console.log(`  - ${f.proname}(${f.args})  [prosecdef=${f.prosecdef}, proconfig=${JSON.stringify(f.proconfig)}]`);
  }
  if (mutable.length === 0) console.log("  none — all functions pin search_path");
  console.log("  scanned functions (for the record):");
  for (const f of fns) {
    const pinned = (f.proconfig ?? []).some((c) => /^\s*search_path\s*=/i.test(c));
    console.log(`    ${pinned ? "✓" : "✗"} ${f.proname}(${f.args}) [prosecdef=${f.prosecdef}]`);
  }
  console.log("");

  // ---- Finding 2: public_bucket_allows_listing ----
  const buckets = await runSql<BucketRow>(`
    SELECT id, name, public FROM storage.buckets ORDER BY name;
  `);
  const policies = await runSql<PolRow>(`
    SELECT pol.policyname, pol.cmd, pol.roles,
           pol.qual::text AS using_expr,
           pol.with_check::text AS with_check
      FROM pg_policies pol
     WHERE pol.schemaname = 'storage' AND pol.tablename = 'objects'
     ORDER BY pol.cmd, pol.policyname;
  `);
  const selectPols = policies.filter((p) => p.cmd === "SELECT");

  console.log(`=== public_bucket_allows_listing ===`);
  console.log(`buckets: ${buckets.length} total, ${buckets.filter((b) => b.public).length} public`);
  for (const b of buckets) {
    const matching = selectPols.filter((p) => {
      const expr = `${p.using_expr ?? ""}`;
      // match bucket id or name reference in the USING clause
      return expr.includes(`'${b.id}'`) || expr.includes(`'${b.name}'`) || expr.includes(`${b.id}`) || expr.includes(`${b.name}`);
    });
    const flag = b.public && matching.length > 0 ? "⚠ LISTING OPEN" : (b.public ? "ok (no SELECT policy)" : "private");
    console.log(`  - ${b.name} (public=${b.public}, id=${b.id}) → ${flag}`);
    for (const p of matching) {
      console.log(`      SELECT policy: ${p.policyname}  using: ${p.using_expr}`);
    }
  }
  console.log("");

  console.log(`=== all storage.objects policies (for context) ===`);
  for (const p of policies) {
    console.log(`  ${p.cmd.padEnd(6)} ${p.policyname}  using=${p.using_expr ?? "—"}  with_check=${p.with_check ?? "—"}`);
  }
  console.log("");

  // ---- Public-read sanity (no SELECT policy → reads must come from the public flag) ----
  console.log(`=== public-read sanity (curl one object per bucket) ===`);
  const samples = await runSql<{ bucket_id: string; name: string }>(`
    SELECT bucket_id, name FROM storage.objects
     WHERE bucket_id IN ('blog-assets','covers')
     ORDER BY bucket_id LIMIT 4;
  `);
  if (samples.length === 0) {
    console.log("  no objects found to curl (buckets empty) — skip");
  }
  for (const s of samples) {
    const publicUrl = `${supaUrl.replace(/\/$/, "")}/storage/v1/object/public/${s.bucket_id}/${encodeURIComponent(s.name)}`;
    try {
      const r = await fetch(publicUrl, { method: "GET" });
      console.log(`  ${s.bucket_id}/${s.name} → HTTP ${r.status}`);
    } catch (e: any) {
      console.log(`  ${s.bucket_id}/${s.name} → fetch error ${e.message}`);
    }
  }
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });