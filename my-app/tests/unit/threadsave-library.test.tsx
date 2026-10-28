import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ThreadsaveLibrary from '@/components/ThreadsaveLibrary';
import { filterArchives } from '@/lib/threadsave-library';
import { snapshot } from '../fixtures/threadsave';
import type { SavedThread } from '@/lib/threadsave-sync';
const saved = () => snapshot().archives as SavedThread[];
it('filters exact Unicode category names without confusing reserved display labels', () => {
  const rows = saved(); rows[0].category = '回收筒';
  expect(filterArchives(rows, { scope: 'category', category: '回收筒', query: '' })).toHaveLength(1);
  expect(filterArchives(rows, { scope: 'trash', category: '', query: '' })).toHaveLength(0);
});
it('searches replies and notes with all terms and keeps trash separate', () => {
  const rows = saved();
  expect(filterArchives(rows, { scope: 'all', category: '', query: '原文 私人' })).toHaveLength(1);
  rows[0].deletedAt = 10;
  expect(filterArchives(rows, { scope: 'all', category: '', query: '' })).toHaveLength(0);
  expect(filterArchives(rows, { scope: 'trash', category: '', query: '閱讀' })).toHaveLength(1);
});
it('renders all category labels including empty categories as safe text and no media requests', () => {
  const html = renderToStaticMarkup(<ThreadsaveLibrary initialData={{ categories: ['未分類', '學習 📚', '空分類', '<script>category</script>'], archives: saved(), accepted_at: '2026-10-18T00:00:00Z' }} />);
  expect(html).toContain('空分類'); expect(html).toContain('&lt;script&gt;category&lt;/script&gt;'); expect(html).not.toContain('<script>category');
  expect(html).not.toContain('<img'); expect(html).not.toContain('<video'); expect(html).toContain('私人收藏庫');
});
