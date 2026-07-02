import { readFileSync } from "fs";
import { join } from "path";
import LandingPage from "@/components/LandingPage";
import { getPosts } from "@/lib/db/posts";

const frames = JSON.parse(
  readFileSync(join(process.cwd(), "public", "runner.b64.txt"), "utf8")
) as string[];

export default async function Home() {
  const posts = await getPosts({ status: "published", limit: 3 });
  return <LandingPage frames={frames} posts={posts} />;
}
