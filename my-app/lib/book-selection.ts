import type { ShelfData, ShelfEntry } from "./books";
import { canonicalIsbn } from "./isbn";

function url(value: string | null): string | null {
  try { const u = new URL(value ?? ""); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.toString() : null; } catch { return null; }
}
function entry(input: ShelfEntry): ShelfEntry {
  const isbn = input.isbn13 ? canonicalIsbn(input.isbn13) : null;
  if (input.isbn13 && !isbn) throw new Error("書架含有無效 ISBN；請先選擇書目或手動加入。");
  if (typeof input.note !== "string" || input.note.length > 2000) throw new Error("書目備註過長。");
  if (!input.selection) {
    if (!isbn) throw new Error("請先選擇書目，或移除空白項目。");
    return { isbn13: isbn, note: input.note };
  }
  const s = input.selection;
  const b = s.book;
  if (!b || typeof b.title !== "string" || !b.title.trim() || b.title.length > 500 || !Array.isArray(b.authors) || b.authors.length > 20 || b.authors.some(a => typeof a !== "string" || a.length > 200)) throw new Error("書名或作者資料無效。");
  if (!["google", "openlibrary", "web", "manual"].includes(s.source) || !["exact", "same-work", "other-language", "possible", "manual"].includes(s.match) || !["zh-Hant", "zh-Hans", "en", "other", "unknown"].includes(s.language)) throw new Error("書目來源資料無效。");
  if ((b.isbn13 ? canonicalIsbn(b.isbn13) : null) !== isbn) throw new Error("選定版本與書架 ISBN 不一致，請重新選擇。");
  const text = (v: string | null) => typeof v === "string" ? v.slice(0, 500) : null;
  return { isbn13: isbn ?? "", note: input.note, ...(input.requestedIsbn ? {requestedIsbn: canonicalIsbn(input.requestedIsbn) ?? undefined} : {}), selection: { source:s.source, language:s.language, match:s.match, book: { googleBooksId: text(b.googleBooksId) || `manual:${crypto.randomUUID()}`, title:b.title.trim(), subtitle:text(b.subtitle), authors:b.authors, publisher:text(b.publisher), publishedDate:text(b.publishedDate), pageCount:typeof b.pageCount === "number" && b.pageCount > 0 && b.pageCount < 100000 ? b.pageCount : null, isbn13:isbn, isbn10:text(b.isbn10), infoLink:url(b.infoLink), thumbnail:url(b.thumbnail), coverUrl:url(b.coverUrl), coverSource:b.coverSource === "google" || b.coverSource === "openlibrary" ? b.coverSource : null } } };
}
export function validateShelf(shelf: ShelfData): ShelfData {
  if (!Array.isArray(shelf.currentlyReading) || !Array.isArray(shelf.tbr) || shelf.currentlyReading.length + shelf.tbr.length > 100) throw new Error("書架資料無效或超過 100 本。");
  return {currentlyReading:shelf.currentlyReading.map(entry),tbr:shelf.tbr.map(entry)};
}
