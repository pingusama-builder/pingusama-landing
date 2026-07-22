// Supabase Security Advisor + table-inventory probe (read-only).
// Pulls ALL advisor findings (not just the 2 the schema-security-lint skill
// covers) via the Management API, grouped by severity, plus a full
// public-table inventory (RLS status + row count). Reads SUPABASE_ACCESS_TOKEN
// from .env.local (never prints it). Run: npx tsx scripts/advisor-check.ts
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
if (!token) { console.error("SUPABASE_ACCESS_TOKEN not found"); process.exit(1); }

const HEADERS = { Authorization: `Bearer ${token}` };

async function main() {
  console.log(`project ref: ${ref}`);
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/advisors/security`, { headers: HEADERS });
  const body: any = await res.json();
  const lints: any[] = body?.lints ?? [];
  console.log(`HTTP ${res.status} · ${lints.length} findings\n`);
  const byLevel: Record<string, any[]> = {};
  for (const l of lints) (byLevel[l.level] ??= []).push(l);
  for (const level of ["ERROR", "WARN", "INFO", "HA", "EXPERIMENTAL"]) {
    const arr = byLevel[level] ?? [];
    if (arr.length === 0) continue;
    console.log(`=== ${level} (${arr.length}) ===`);
    for (const l of arr) {
      console.log(`  [${l.name}] ${l.detail}`);
    }
    console.log("");
  }
  // also surface distinct lint names
  const names = Array.from(new Set(lints.map((l) => l.name)));
  console.log(`distinct lint names: ${names.join(", ")}\n`);

  // ---- full public-table inventory: RLS status + row count ----
  console.log(`=== public-table inventory (RLS status + row count) ===`);
  const tables = await runSql(`
    SELECT c.relname AS table_name,
           c.relrowsecurity AS rls_on,
           (SELECT count(*) FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname;
  `);
  for (const t of tables) {
    const cnt = await runSql(`SELECT count(*) AS n FROM public.${quoteIdent(t.table_name)};`);
    const n = cnt?.[0]?.n ?? "?";
    console.log(`  ${String(t.rls_on) === "true" ? "rls✓" : "rls✗ "} policies=${t.policy_count ?? 0}  rows=${n}  ${t.table_name}`);
  }
}

function quoteIdent(s: string) { return '"' + s.replace(/"/g, '""') + '"'; }
async function runSql<T = any>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 300)}`);
  let body: any = text; try { body = text ? JSON.parse(text) : null; } catch {}
  let rows: any[] = [];
  if (Array.isArray(body)) rows = body;
  else if (Array.isArray(body?.rows)) rows = body.rows;
  else if (Array.isArray(body?.data)) rows = body.data;
  return rows as T[];
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });