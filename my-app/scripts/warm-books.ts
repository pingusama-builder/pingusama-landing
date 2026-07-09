import { config } from "dotenv";
config({ path: ".env.local" });

import { loadShelf } from "@/lib/db/bench";
import { warmBook } from "@/lib/books";
import { normalizeIsbn13, isValidIsbn13 } from "@/lib/isbn";

async function main() {
  const force = process.argv.includes("--force");
  const shelf = await loadShelf();
  const entries = [...shelf.currentlyReading, ...shelf.tbr];
  const seen = new Set<string>();

  for (const entry of entries) {
    const isbn = normalizeIsbn13(entry.isbn13);
    if (!isValidIsbn13(isbn)) {
      console.warn(`SKIP  ${entry.isbn13 || "(empty)"} — invalid ISBN`);
      continue;
    }
    if (seen.has(isbn)) continue;
    seen.add(isbn);

    console.log(`WARM  ${isbn} …`);
    const result = await warmBook(isbn, { force });
    console.log(`  -> ${result.status}${result.error ? ` (${result.error})` : ""}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});