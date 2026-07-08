// Spike: fetch a book from Google Books API by ISBN or query.
// Run: npx tsx scripts/fetch-book.ts <isbn-or-query>
// Example: npx tsx scripts/fetch-book.ts 9780307473394
import * as fs from "node:fs";
import * as path from "node:path";

const envFile = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const API = "https://www.googleapis.com/books/v1/volumes";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

async function main() {
  const input = process.argv[2]?.trim() || "What I Talk About When I Talk About Running Murakami";
  const isIsbn = /^[0-9\-Xx]{10,17}$/.test(input);
  const q = isIsbn ? `isbn:${input.replace(/-/g, "")}` : input;
  const key = env("GOOGLE_BOOKS_API_KEY");

  console.log(`searching: ${q}`);
  const url = `${API}?q=${encodeURIComponent(q)}&maxResults=3&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  if (!data.items?.length) {
    console.log("no results");
    process.exit(0);
  }

  const books = data.items.map((item: any) => {
    const v = item.volumeInfo || {};
    return {
      googleBooksId: item.id,
      title: v.title,
      subtitle: v.subtitle || null,
      authors: v.authors || [],
      publisher: v.publisher || null,
      publishedDate: v.publishedDate || null,
      pageCount: v.pageCount || null,
      infoLink: v.infoLink || null,
      thumbnail: v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null,
      isbn13: v.industryIdentifiers?.find((x: any) => x.type === "ISBN_13")?.identifier || null,
      isbn10: v.industryIdentifiers?.find((x: any) => x.type === "ISBN_10")?.identifier || null,
    };
  });

  console.log(JSON.stringify(books, null, 2));
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });