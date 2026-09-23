import { requireAdmin } from '@/lib/auth';
import ChalkAdmin from '@/components/ChalkAdmin';
export default async function Page() { await requireAdmin(); return <ChalkAdmin />; }
