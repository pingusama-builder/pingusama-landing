import { readFileSync } from "fs";
import { join } from "path";
import LandingPage from "@/components/LandingPage";
import { getPosts } from "@/lib/db/posts";
import { resolveShelf } from "@/lib/books";
import { loadShelf, loadVault } from "@/lib/db/bench";

const frames = JSON.parse(
  readFileSync(join(process.cwd(), "public", "runner.b64.txt"), "utf8")
) as string[];

export const revalidate = 3600;

export default async function Home() {
  const rawShelf = await loadShelf();
  const [posts, shelf, vault] = await Promise.all([
    getPosts({ status: "published", limit: 3 }),
    resolveShelf(rawShelf),
    loadVault(),
  ]);
  return <LandingPage frames={frames} posts={posts} shelf={shelf} vault={vault} />;
}
