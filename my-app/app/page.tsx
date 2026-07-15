import { readFileSync } from "fs";
import { join } from "path";
import LandingPage from "@/components/LandingPage";
import { getPosts } from "@/lib/db/posts";
import { resolveShelf } from "@/lib/books";
import { loadShelf, loadVault } from "@/lib/db/bench";

const frames = JSON.parse(
  readFileSync(join(process.cwd(), "public", "runner.b64.txt"), "utf8")
) as string[];

// NOTE: no time-based revalidate. / is a plain static page. It regenerates
// on-demand via revalidatePath("/") in admin actions (blog save/delete in
// app/admin/blog/actions.ts, bench warm/preview in app/admin/bench/actions.ts).
// A 1h revalidate burned ~4790 ISR writes/day because every request after the
// stale window triggered a background segment-cache regeneration.
export default async function Home() {
  const rawShelf = await loadShelf();
  const [posts, shelf, vault] = await Promise.all([
    getPosts({ status: "published", limit: 3 }),
    resolveShelf(rawShelf),
    loadVault(),
  ]);
  return <LandingPage frames={frames} posts={posts} shelf={shelf} vault={vault} />;
}
