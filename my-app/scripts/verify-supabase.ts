import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  const supabase = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: ws as unknown as WebSocket },
  });

  const { data, error } = await supabase
    .from("posts")
    .select("id, slug, title, created_at")
    .limit(1);

  if (error) {
    console.error("Supabase connection failed:", error.message);
    process.exit(1);
  }

  console.log("Supabase connection OK. Sample row:", data);

  const bucket = await supabase.storage.getBucket("blog-assets");
  if (bucket.error) {
    console.error("Bucket check failed:", bucket.error.message);
    process.exit(1);
  }
  console.log("Storage bucket OK:", bucket.data.name, "public:", bucket.data.public);
}

main();
