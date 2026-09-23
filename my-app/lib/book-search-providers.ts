import { fetchBookByIsbn, fetchBookByOpenLibrary, type Book } from "./books";
import { canonicalIsbn } from "./isbn";
import { inferLanguage, type FoundBook, type SearchProviders, type BookLanguage } from "./book-search";

const DAY = 86400;
const emptyBook = (title: string): Book => ({ googleBooksId: "", title, subtitle: null, authors: [], publisher: null, publishedDate: null, pageCount: null, infoLink: null, thumbnail: null, isbn13: null, isbn10: null, coverUrl: null, coverSource: null });
export function safeBookUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}
async function json<T>(url: string, provider: string, init: RequestInit = {}): Promise<T> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), next: { revalidate: DAY } });
    if (!res.ok) throw new Error();
    return await res.json() as T;
  } catch { throw new Error(`${provider} 暫時無法查詢（可能逾時或達到限額），可稍後重試。`); }
}
// One request/second per server process; no fan-out across OL editions.
let olQueue: Promise<unknown> = Promise.resolve();
let olLast = 0;
function openLibrary<T>(request: () => Promise<T>): Promise<T> {
  const next = olQueue.then(async () => {
    const delay = Math.max(0, olLast + 1050 - Date.now());
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    olLast = Date.now(); return request();
  });
  olQueue = next.catch(() => undefined); return next;
}
async function combine(calls: Promise<FoundBook[]>[]): Promise<FoundBook[]> {
  const outcomes = await Promise.allSettled(calls);
  const found = outcomes.flatMap(r => r.status === "fulfilled" ? r.value : []);
  const failed = outcomes.find(r => r.status === "rejected");
  if (!found.length && failed?.status === "rejected") throw failed.reason;
  return found;
}
interface GoogleVolume { id: string; volumeInfo?: { title?: string; subtitle?: string; authors?: string[]; publisher?: string; publishedDate?: string; pageCount?: number; language?: string; infoLink?: string; imageLinks?: {thumbnail?: string}; industryIdentifiers?: {identifier: string}[] }; }
async function googleTitles(title: string, author: string, language?: BookLanguage): Promise<FoundBook[]> {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) throw new Error("Google Books API key 未設定。");
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", `intitle:${JSON.stringify(title)} inauthor:${JSON.stringify(author)}`);
  url.searchParams.set("maxResults", "10"); url.searchParams.set("key", key);
  if (language && language !== "unknown") url.searchParams.set("langRestrict", language === "en" ? "en" : "zh");
  const data = await json<{items?: GoogleVolume[]}>(url.toString(), "Google Books");
  return (data.items ?? []).flatMap(item => {
    const v = item.volumeInfo;
    if (!v?.title) return [];
    const isbn = v.industryIdentifiers?.map(x => canonicalIsbn(x.identifier)).find(Boolean) ?? null;
    const image = safeBookUrl(v.imageLinks?.thumbnail)?.replace(/^http:/, "https:") ?? null;
    return [{ source: "google" as const, language: inferLanguage(v.title + (v.publisher ?? ""), v.language), book: { ...emptyBook(v.title), googleBooksId: item.id, subtitle: v.subtitle ?? null, authors: v.authors ?? [], publisher: v.publisher ?? null, publishedDate: v.publishedDate ?? null, pageCount: v.pageCount ?? null, infoLink: safeBookUrl(v.infoLink), isbn13: isbn, thumbnail: image, coverUrl: image, coverSource: image ? "google" as const : null } }];
  });
}
interface Edition { key?: string; title?: string; subtitle?: string; isbn_13?: string[]; isbn_10?: string[]; publishers?: string[]; publish_date?: string; number_of_pages?: number; covers?: number[]; languages?: {key:string}[]; }
async function olTitles(title: string, author: string, language?: BookLanguage): Promise<FoundBook[]> {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("title", title); url.searchParams.set("author", author); url.searchParams.set("limit", "2"); url.searchParams.set("fields", "key,title,author_name");
  if (language && language !== "unknown") url.searchParams.set("q", `language:${language === "en" ? "eng" : "chi"}`);
  const data = await openLibrary(() => json<{docs?: {key:string; author_name?:string[]}[]}>(url.toString(), "Open Library"));
  const found: FoundBook[] = [];
  for (const work of data.docs ?? []) {
    if (!/^\/works\/OL\d+W$/.test(work.key)) continue;
    const editions = await openLibrary(() => json<{entries?:Edition[]}>(`https://openlibrary.org${work.key}/editions.json?limit=20`, "Open Library"));
    for (const e of editions.entries ?? []) {
      if (!e.title || !e.key || !/^\/books\/OL\d+M$/.test(e.key)) continue;
      const isbn = [...(e.isbn_13 ?? []), ...(e.isbn_10 ?? [])].map(canonicalIsbn).find(Boolean) ?? null;
      const coverId = e.covers?.find(n => n > 0);
      const cover = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null;
      found.push({ source: "openlibrary", language: inferLanguage(e.title + (e.publishers?.join("") ?? ""), e.languages?.[0]?.key.split("/").pop()), book: { ...emptyBook(e.title), googleBooksId: `ol:${e.key}`, subtitle: e.subtitle ?? null, authors: work.author_name ?? [], publisher: e.publishers?.[0] ?? null, publishedDate: e.publish_date ?? null, pageCount: e.number_of_pages ?? null, isbn13: isbn, infoLink: `https://openlibrary.org${e.key}`, thumbnail: cover, coverUrl: cover, coverSource: cover ? "openlibrary" : null } });
    }
  }
  return found;
}

/** Conservative extraction: labelled bibliographic fields, not free-form mentions.
 * Ambiguous pages remain leads for the administrator to inspect. */
export function parseBookPage(content: string, sourceUrl: string): FoundBook | null {
  const url = safeBookUrl(sourceUrl);
  if (!url) return null;
  const text = content.slice(0, 60000).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "");
  const nextLabel = "書名|书名|Title|作者|Author|Authors|出版社|出版者|Publisher|出版日期|出版日|出版时间|Published|Publication date|ISBN(?:-1[03])?|書系|书系|城邦書號|規格|规格|語言|语言|Language";
  const field = (labels: string) => text.match(new RegExp(`(?:^|\\n|\\||\\s)(?:${labels})\\s*[:：]\\s*([^\\n|]+?)(?=\\s+(?:${nextLabel})\\s*[:：]|\\n|\\||$)`, "i"))?.[1]?.trim();
  const headings = [...text.matchAll(/^\s*#\s+([^#\n]+)$/gm)].map(m=>m[1].trim()).filter(Boolean);
  const title = field("書名|书名|Title") ?? (headings.length === 1 ? headings[0] : undefined);
  const author = field("作者|Author|Authors");
  const ids = [...text.matchAll(/(?:ISBN(?:-1[03])?)\s*[:：]?\s*([\dXx][\dXx \t-]{8,22}[\dXx])/gi)].map(m => canonicalIsbn(m[1])).filter(Boolean);
  const unique = [...new Set(ids)];
  if (!title || !author || unique.length !== 1) return null;
  const publisher = field("出版社|出版者|Publisher") ?? null;
  return { source: "web", language: inferLanguage(title + (publisher ?? ""), field("語言|语言|Language")?.replace("繁體中文", "zh-Hant").replace("简体中文", "zh-Hans").replace("簡體中文", "zh-Hans").replace("English", "en")), book: { ...emptyBook(title), googleBooksId: `web:${unique[0]}`, authors: author.split(/[、;；]/).map(a => a.trim()).filter(Boolean), publisher, publishedDate: field("出版日期|出版日|出版时间|Published|Publication date") ?? null, isbn13: unique[0], infoLink: url } };
}
type WebResults = Awaited<ReturnType<SearchProviders["web"]>>;
const webCache = new Map<string, {expires:number; value:Promise<WebResults>}>();
async function webSearch(query: string): Promise<WebResults> {
  const cached = webCache.get(query);
  if (cached && cached.expires > Date.now()) return cached.value;
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("Web 搜尋未設定；可以手動加入書目。");
  const promise = (async () => {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    const results = await json<{results?:{title?:string;url:string;content?:string;raw_content?:string}[]}>("https://api.tavily.com/search", "Web 搜尋", {method:"POST",headers,body:JSON.stringify({query,search_depth:"basic",max_results:3,include_answer:false,include_raw_content:"markdown"})});
    const terms = [...query.matchAll(/"([^"]+)"/g)].map(m=>m[1].toLowerCase()).filter(Boolean);
    const sources = (results.results ?? []).filter(r => safeBookUrl(r.url) && terms.every(t=>`${r.title} ${r.content} ${r.raw_content}`.toLowerCase().includes(t))).slice(0, 3);
    const candidates = sources.flatMap(r => {const b = r.raw_content ? parseBookPage(r.raw_content, r.url) : null; return b ? [b] : [];});
    const missing = sources.filter(r => !r.raw_content);
    const warnings: string[] = [];
    if (missing.length) {
      try {
        const pages = await json<{results?:{url:string;raw_content?:string}[]}>("https://api.tavily.com/extract", "來源頁面讀取", {method:"POST",headers,body:JSON.stringify({urls:missing.map(r=>r.url),extract_depth:"basic",format:"text"})});
        for (const page of pages.results ?? []) { const b = parseBookPage(page.raw_content ?? "", page.url); if (b) candidates.push(b); }
      } catch (error) {
        if (!candidates.length) throw error;
        warnings.push("部分來源頁面暫時無法讀取；已保留成功讀取的書目。");
      }
    }
    return {candidates, leads:sources.map(s => ({title:s.title || s.url,url:s.url})),warnings};
  })();
  if (webCache.size >= 100) webCache.delete(webCache.keys().next().value!);
  webCache.set(query, {expires:Date.now()+DAY*1000,value:promise});
  promise.catch(()=>webCache.delete(query));
  return promise;
}
export const bookProviders: SearchProviders = {
  exact: isbn => combine([
    fetchBookByIsbn(isbn, true).then(b => b ? [{book:{...b,infoLink:safeBookUrl(b.infoLink),coverUrl:safeBookUrl(b.thumbnail)?.replace(/^http:/,"https:") ?? null,coverSource:b.thumbnail ? "google" : null},language:inferLanguage(b.title+(b.publisher??"")),source:"google"}] : []),
    openLibrary(()=>fetchBookByOpenLibrary(isbn,true)).then(r => r ? [{book:{...r.book,coverUrl:r.olCoverUrl,coverSource:r.olCoverUrl ? "openlibrary" : null},language:inferLanguage(r.book.title+(r.book.publisher??"")),source:"openlibrary"}] : [])
  ]),
  titles: (title,author,language) => combine([googleTitles(title,author,language),olTitles(title,author,language)]),
  web: webSearch,
};
