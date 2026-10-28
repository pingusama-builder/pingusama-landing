import type { SavedThread } from './threadsave-sync';
export type LibraryFilter = { scope: 'all' | 'starred' | 'trash' | 'category'; category: string; query: string };
export function filterArchives(archives: SavedThread[], filter: LibraryFilter): SavedThread[] {
  const terms = filter.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return archives.filter(a => {
    if ((filter.scope === 'trash') !== (a.deletedAt > 0)) return false;
    if (filter.scope === 'starred' && !a.starred) return false;
    if (filter.scope === 'category' && a.category !== filter.category) return false;
    const fields = [a.category, a.note, a.sharedText, a.preview, ...a.tags, ...a.posts.flatMap(p => [p.username, p.text])].map(s => s.toLocaleLowerCase());
    return terms.every(t => fields.some(f => f.includes(t)));
  }).sort((a, b) => b.savedAt - a.savedAt);
}
