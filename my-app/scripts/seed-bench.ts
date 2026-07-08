import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ws from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function loadJson<T>(name: string): T {
  const raw = readFileSync(
    join(process.cwd(), "lib", "data", `${name}.json`),
    "utf8"
  );
  return JSON.parse(raw) as T;
}

async function main() {
  const supabase = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: ws as unknown as WebSocket },
  });

  const shelf = loadJson("shelf");
  const vault = loadJson("vault");

  const { error } = await supabase.from("bench").upsert(
    [
      { key: "shelf", data: shelf, updated_at: new Date().toISOString() },
      { key: "vault", data: vault, updated_at: new Date().toISOString() },
    ],
    { onConflict: "key" }
  );

  if (error) {
    console.error("Failed to seed bench:", error.message);
    process.exit(1);
  }

  console.log("Bench seeded successfully.");
}

main();
