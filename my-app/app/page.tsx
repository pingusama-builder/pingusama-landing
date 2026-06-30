import { readFileSync } from "fs";
import { join } from "path";
import LandingPage from "@/components/LandingPage";

const frames = JSON.parse(
  readFileSync(join(process.cwd(), "public", "runner.b64.txt"), "utf8")
) as string[];

export default function Home() {
  return <LandingPage frames={frames} />;
}
