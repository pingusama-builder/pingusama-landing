import { traceBench } from "./bench-trace";
import { Converter } from "opencc-js";
import type { Book } from "./books";
import { canonicalIsbn } from "./isbn";

export type BookLanguage = "zh-Hant" | "zh-Hans" | "en" | "other" | "unknown";
export interface BookSearchInput { isbn?: string; title?: string; author?: string; language?: BookLanguage; otherLanguages?: boolean; alias?: string; }
export interface FoundBook { book: Book; language: BookLanguage; source: "google" | "openlibrary" | "web" | "manual"; }
export interface BookCandidate extends FoundBook { match: "exact" | "same-work" | "other-language" | "possible" | "manual"; }
export interface BookLead { title: string; url: string; }
export interface BookSearchResult { candidates: BookCandidate[]; leads: BookLead[]; warnings: string[]; }
export interface SearchProviders {
  exact(isbn: string): Promise<FoundBook[]>;
  titles(title: string, author: string, language?: BookLanguage): Promise<FoundBook[]>;
  web(query: string): Promise<{ candidates: FoundBook[]; leads: BookLead[]; warnings?: string[] }>;
}
const simplified = Converter({ from: "tw", to: "cn" });
const traditional = Converter({ from: "cn", to: "tw" });
const norm = (s: string) => simplified(s.normalize("NFKC")).toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
const mainTitle = (s: string) => s.normalize("NFKC").split(/[:：]/)[0].replace(/[（(](?:新版|修訂版|修订版|紀念版|纪念版)[）)]/g, "").trim();
export function titleQueries(title: string): string[] {
  return [...new Set([title.trim(), simplified(title.trim()), traditional(title.trim()), mainTitle(title), simplified(mainTitle(title))])].filter(Boolean).slice(0, 5);
}
export function inferLanguage(title: string, language?: string): BookLanguage {
  if (/^(en|eng)$/.test(language ?? "")) return "en";
  if (/hant|zh-tw|zh-hk/i.test(language ?? "")) return "zh-Hant";
  if (/hans|zh-cn/i.test(language ?? "")) return "zh-Hans";
  if (language && !/^(zh|chi|zho|中文|Chinese)$/i.test(language)) return "other";
  if (simplified(title) !== title) return "zh-Hant";
  if (traditional(title) !== title) return "zh-Hans";
  return "unknown";
}
export function sameWork(input: BookSearchInput, book: Book): boolean {
  if (!input.title || !input.author) return false;
  const authorNames = (a: string) => [a, a.replace(/\([^)]*\)|（[^）]*）/g, ""), ...(a.match(/(?<=[(（])[^)）]+/g) ?? [])].map(norm);
  if (!book.authors.some(a => authorNames(a).some(n=>authorNames(input.author!).includes(n)))) return false;
  // Volume/part numbers anywhere in the title remain identity-bearing.
  const volumes = (s: string) => (simplified(s).match(/\d+|第[一二三四五六七八九十百]+[卷册部集]|[上下中][卷册部]/g) ?? []).join("|");
  if (volumes(input.title) !== volumes(book.title)) return false;
  return [input.title, input.alias].filter(Boolean).some(t => norm(mainTitle(t!)) === norm(mainTitle(book.title)));
}
const changedContent = /改編|改编|漫畫|漫画|節譯|节译|縮寫|缩写|增訂|增订|abridged|adaptation|expanded/i;

export async function searchBooks(input: BookSearchInput, providers?: SearchProviders): Promise<BookSearchResult> {
  const result: BookSearchResult = { candidates: [], leads: [], warnings: [] };
  const p = providers ?? (await import("./book-search-providers")).bookProviders;
  const isbn = input.isbn?.trim() ? canonicalIsbn(input.isbn) : null;
  if (input.isbn?.trim() && !isbn) throw new Error("請輸入有效 ISBN-10 或 ISBN-13。");
  if (!isbn && !input.title?.trim()) throw new Error("請輸入 ISBN 或書名。");
  if ((input.title?.length ?? 0) > 200 || (input.author?.length ?? 0) > 120 || (input.alias?.length ?? 0) > 200) throw new Error("搜尋字串過長。");
  const safe = async <T>(call: () => Promise<T>, fallback: T): Promise<T> => {
    const started=Date.now();
    try { const value=await call();traceBench("search.provider","completed",{durationMs:Date.now()-started});return value; } catch (e) {traceBench("search.provider","failed",{durationMs:Date.now()-started,code:"provider_error"}); result.warnings.push(e instanceof Error ? e.message : "來源暫時無法查詢。"); return fallback; }
  };
  const add = (found: FoundBook[], exactOnly = false) => {
    for (const item of found) {
      const exact = !!isbn && canonicalIsbn(item.book.isbn13 ?? item.book.isbn10 ?? "") === isbn;
      if (!exact && item.language === "other") continue;
      if (!exact && (exactOnly || !sameWork(input, item.book))) continue;
      const target = input.language ?? "unknown";
      const other = item.language !== "unknown" && target !== "unknown" && item.language !== target;
      if (!exact && other && !input.otherLanguages) continue;
      const match = exact ? "exact" : changedContent.test(item.book.title) || item.language === "unknown" ? "possible" : other ? "other-language" : "same-work";
      const key = item.book.isbn13 || item.book.infoLink || item.book.googleBooksId;
      const existing = result.candidates.findIndex(c => (c.book.isbn13 || c.book.infoLink || c.book.googleBooksId) === key);
      if (existing < 0) result.candidates.push({ ...item, match });
      else if (result.candidates[existing].match === "possible" && match !== "possible") result.candidates[existing] = {...item,match};
    }
    const rank = {exact:0,"same-work":1,"other-language":2,possible:3,manual:4};
    result.candidates = result.candidates.sort((a,b)=>rank[a.match]-rank[b.match]).slice(0, 5);
  };
  if (isbn) {
    add(await safe(() => p.exact(isbn), []), true);
    if (result.candidates.length) return result;
  }
  if (input.title && input.author) {
    for (const title of titleQueries(input.title)) {
      add(await safe(() => p.titles(title, input.author!, input.otherLanguages ? undefined : input.language), []));
      if (result.candidates.some(c => c.match !== "possible")) return result;
    }
    if (input.alias && input.otherLanguages) add(await safe(() => p.titles(input.alias!, input.author!), []));
    if (result.candidates.some(c => c.match !== "possible")) return result;
  }
  // Two queries total, never an unbounded per-provider/per-language expansion.
  const queries = [...new Set([isbn ? `"${isbn}"` : `"${input.title}" "${input.author ?? ""}" ISBN`, input.title ? `"${mainTitle(input.title)}" "${input.author ?? ""}" ISBN 出版社` : ""])].filter(Boolean).slice(0, 2);
  for (const query of queries) {
    const web = await safe(() => p.web(query), { candidates: [], leads: [] });
    add(web.candidates);
    result.warnings.push(...(web.warnings ?? []));
    result.leads.push(...web.leads);
    if (result.candidates.some(c => c.match !== "possible")) break;
  }
  if (!input.author && !result.candidates.length) result.warnings.push("未能確認作品；請補充書名及作者再搜尋，或手動加入。");
  result.leads = [...new Map(result.leads.map(l => [l.url, l])).values()].slice(0, 5);
  result.warnings = [...new Set(result.warnings)];
  return result;
}
