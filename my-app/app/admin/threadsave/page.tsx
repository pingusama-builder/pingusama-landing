import { requireAdmin } from '@/lib/auth';
import AdminHeader from '@/components/AdminHeader';
import ThreadsaveLibrary from '@/components/ThreadsaveLibrary';
import styles from '@/components/ThreadsaveLibrary.module.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Threadsave 私人收藏庫 · Pingu', robots: { index: false, follow: false } };
export default async function Page() {
  await requireAdmin();
  return <><div className={styles.adminHeader}><AdminHeader /></div><ThreadsaveLibrary /></>;
}
