// RLS probe — proves whether public.posts is protected, via the PostgREST REST API.
// Run: npx tsx scripts/check-rls.ts   (reads .env.local; never prints keys)
import * as fs from "node:fs";
import * as path from "node:path";

const envFile = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const env: Record<string, string> = {};
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY!;
const REST = url.replace(/\/$/, "") + "/rest/v1";

async function req(key: string, method: string, p: string, body?: object) {
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Prefer"] = "return=representation";
  }
  const res = await fetch(REST + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const stamp = Date.now().toString(36);

async function main() {
  console.log("=== ANON read probe ===");
  const r1 = await req(anonKey, "GET", "/posts?select=id,status");
  if (r1.status !== 200) {
    console.log(`  anon SELECT -> HTTP ${r1.status}`, JSON.stringify(r1.data));
    console.log("  -> READ BLOCKED (RLS likely already on, no SELECT policy for anon)");
  } else {
    const rows = r1.data as any[];
    const drafts = rows.filter((p: any) => p.status === "draft").length;
    console.log(`  anon SELECT -> HTTP 200, ${rows.length} rows (drafts visible: ${drafts})`);
    console.log(drafts > 0 ? "  -> READ HOLE OPEN (anon sees drafts)" : "  -> anon reads only published (or no drafts exist)");
  }

  console.log("=== ANON insert probe ===");
  const r2 = await req(anonKey, "POST", "/posts?select=id", {
    slug: `__rls_probe_${stamp}__`, title: "RLS probe — delete me", excerpt: "p",
    content_markdown: "p", content_html: "p", status: "draft",
  });
  if (r2.status === 201) {
    console.log(`  anon INSERT -> HTTP 201, row id ${(r2.data as any[])?.[0]?.id}`);
    console.log("  -> WRITE HOLE OPEN (anyone can create posts)");
    const id = (r2.data as any[])?.[0]?.id;
    if (id) { const d = await req(serviceKey, "DELETE", `/posts?id=eq.${id}`); console.log(`  cleaned up via service role: HTTP ${d.status}`); }
  } else {
    console.log(`  anon INSERT -> HTTP ${r2.status}`, JSON.stringify(r2.data));
    console.log("  -> WRITE HOLE CLOSED (RLS blocking inserts)");
  }

  console.log("=== ANON delete probe ===");
  const ins = await req(serviceKey, "POST", "/posts?select=id", {
    slug: `__rls_probe_${stamp}_d__`, title: "RLS delete probe — delete me", excerpt: "p",
    content_markdown: "p", content_html: "p", status: "draft",
  });
  const id = (ins.data as any[])?.[0]?.id;
  if (id) {
    const r3 = await req(anonKey, "DELETE", `/posts?id=eq.${id}`);
    if (r3.status === 204 || r3.status === 200) {
      // check if row still exists
      const check = await req(serviceKey, "GET", `/posts?id=eq.${id}&select=id`);
      const stillThere = (check.data as any[])?.length > 0;
      console.log(`  anon DELETE -> HTTP ${r3.status}, row still exists: ${stillThere}`);
      console.log(stillThere ? "  -> DELETE BLOCKED (RLS on)" : "  -> DELETE HOLE OPEN (anyone can delete posts)");
      if (stillThere) await req(serviceKey, "DELETE", `/posts?id=eq.${id}`);
    } else {
      console.log(`  anon DELETE -> HTTP ${r3.status}`, JSON.stringify(r3.data));
      console.log("  -> DELETE BLOCKED (RLS on)");
      await req(serviceKey, "DELETE", `/posts?id=eq.${id}`);
    }
  }

  console.log("=== SERVICE role sanity ===");
  const s = await req(serviceKey, "GET", "/posts?select=id&limit=1");
  console.log(`  service SELECT -> HTTP ${s.status} (${(s.data as any[])?.length ?? 0} row ok)`);

  console.log("=== CLEANUP — remove any leftover probe rows ===");
  const all = await req(serviceKey, "GET", "/posts?select=id,slug");
  const junk = (all.data as any[])?.filter((p: any) => /rls_probe/i.test(p.slug ?? "")) ?? [];
  for (const j of junk) {
    const d = await req(serviceKey, "DELETE", `/posts?id=eq.${j.id}`);
    console.log(`  deleted ${j.slug}: HTTP ${d.status}`);
  }
  if (junk.length === 0) console.log("  none found");
}

main().catch(e => { console.error("fatal:", e); process.exit(1); });