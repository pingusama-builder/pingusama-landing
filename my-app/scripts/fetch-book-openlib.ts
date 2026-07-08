// Spike: fetch book metadata + cover from Open Library by ISBN (no API key).
// Run: npx tsx scripts/fetch-book-openlib.ts <isbn>

async function main() {
  const isbn = (process.argv[2] || "9780307473394").replace(/-/g, "");

  console.log(`Open Library lookup: ${isbn}`);

  // metadata
  const metaRes = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
  if (!metaRes.ok) {
    console.error(`metadata HTTP ${metaRes.status}: ${await metaRes.text()}`);
    process.exit(1);
  }
  const meta = await metaRes.json();

  // author names
  const authors: string[] = [];
  if (meta.authors?.length) {
    for (const a of meta.authors) {
      try {
        const r = await fetch(`https://openlibrary.org${a.key}.json`);
        const d = await r.json();
        if (d.name) authors.push(d.name);
      } catch { /* ignore */ }
    }
  }

  const coverUrl = meta.covers?.[0]
    ? `https://covers.openlibrary.org/b/id/${meta.covers[0]}-M.jpg`
    : null;

  console.log(JSON.stringify({
    isbn,
    title: meta.title,
    subtitle: meta.subtitle || null,
    authors,
    publishDate: meta.publish_date || null,
    coverUrl,
    openLibraryUrl: `https://openlibrary.org/isbn/${isbn}`,
  }, null, 2));
}

main().catch(e => { console.error("fatal:", e); process.exit(1); });