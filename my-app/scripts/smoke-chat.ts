// Manual live smoke for the chat data layer against prod Supabase.
// Run:  npx tsx --env-file=.env.local scripts/smoke-chat.ts
// It writes a temporary memory, recalls it, updates it, soft-deletes it, then
// hard-deletes the row to leave no trace. Exits non-zero on any failure.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Load .env.local ourselves in case --env-file isn't honored by this tsx.
try {
  const env = readFileSync(resolve(process.cwd(), ".env.local"), "utf8")
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {
  /* --env-file may have already loaded it */
}

import { saveMemory, recallMemories, updateMemory, deleteMemory } from "@/lib/db/chat"
import { refreshAwareness } from "@/lib/chat/awareness"
import { createServiceClient } from "@/lib/supabase/server"

const NAME = "smoke-test-temp"
let step = 0
const log = (m: string) => console.log(`[${++step}] ${m}`)

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from env")

  // Clean any leftover from a prior aborted run.
  const c = createServiceClient()
  await c.from("chat_memories").delete().eq("name", NAME)
  log("cleaned any leftover smoke row")

  // 1. save → insert path
  const saved = await saveMemory({
    type: "reference",
    name: NAME,
    description: "temporary smoke test",
    content: "smoke",
  })
  log(`saveMemory inserted: id=${saved.id}, name=${saved.name}, active=${saved.active}`)

  // 2. recall finds it
  const recalled = await recallMemories({ limit: 200 })
  const found = recalled.find((r) => r.name === NAME)
  if (!found) throw new Error("recallMemories did not return the smoke row")
  log(`recallMemories found it: type=${found.type}`)

  // 3. save again → update path (dedupe, not duplicate)
  const updated2 = await saveMemory({
    type: "reference",
    name: NAME,
    description: "temporary smoke test (refined)",
    content: "smoke v2",
  })
  log(`saveMemory upserted (same id? ${updated2.id === saved.id})`)
  if (updated2.id !== saved.id) throw new Error("upsert created a duplicate row instead of updating")

  // 4. updateMemory by name
  const upd = await updateMemory(NAME, { content: "smoke v3" })
  log(`updateMemory: content=${upd.content}`)
  if (upd.content !== "smoke v3") throw new Error("updateMemory did not apply the new content")

  // 5. refresh_awareness (deterministic, all categories) — writes site:* rows
  const results = await refreshAwareness()
  log(
    `refreshAwareness: ${results.map((r) => `${r.category}:${r.changed ? "changed" : "same"}`).join(", ")}`
  )

  // 6. soft-delete
  await deleteMemory(NAME)
  const after = await recallMemories({ limit: 200 })
  if (after.find((r) => r.name === NAME))
    throw new Error("deleteMemory did not soft-delete the row")
  log("deleteMemory soft-deleted it (no longer recalled)")

  // 7. hard cleanup so we leave no trace
  await c.from("chat_memories").delete().eq("name", NAME)
  log("hard-deleted the smoke row")

  console.log("\nSMOKE OK ✅ — data layer round-trips against prod Supabase.")
}

main().catch((err) => {
  console.error("\nSMOKE FAILED ❌:", err.message)
  process.exit(1)
})