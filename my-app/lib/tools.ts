export type ToolKey = "epub" | "vn" | "sw" | "words" | "reddit";

export type ToolPlacement =
  | "compass"
  | "workbench"
  | "catalogue"
  | "archive";

export type ToolStatus = "live" | "in-progress" | "resting";

export type CompassDirection = "north" | "east" | "south" | "west";

export interface Tool {
  key: ToolKey;
  eyebrow: string;
  title: string;
  nature: string;
  desc: string;
  status: ToolStatus;
  statusLabel: string;
  href: string;
  placement: ToolPlacement;
  compassDirection?: CompassDirection;
  featuredAt?: string;
}

export const TOOLS: Record<ToolKey, Tool> = {
  epub: {
    key: "epub",
    eyebrow: "the tamer · converter",
    title: "sim2trad 簡繁書轉換",
    nature:
      "你愛讀《凡人修仙傳》、《詭秘之主》但不喜歡簡體字？ Me too。所以我寫了這個，專為超大網絡小說而設的轉換器，連目錄一起。",
    desc: "Upload EPUB, DOCX, or TXT novels in Simplified Chinese and get split, converted Traditional Chinese output (s2t / s2hk / s2tw / s2twp) as real EPUB or TXT files. MOBI and AZW3 are not supported.",
    status: "live",
    statusLabel: "Live",
    href: "https://sim2trad-ebook-converter.vercel.app",
    placement: "compass",
    compassDirection: "north",
  },
  words: {
    key: "words",
    eyebrow: "the keeper · vocab",
    title: "Name of the Words",
    nature: "Its true name: catching the words you almost let go.",
    desc: "A pocket vocabulary app. Save a word today, see it again tomorrow, let the ones that matter root themselves and forget the rest.",
    status: "live",
    statusLabel: "Live",
    href: "https://name-of-words.vercel.app",
    placement: "compass",
    compassDirection: "west",
  },
  vn: {
    key: "vn",
    eyebrow: "the compass · discovery",
    title: "VN Finder",
    nature: "Its true name: a small map of stories I kept replaying.",
    desc: "Look up visual novels by character, route, or scene. Built from the data of games I couldn't stop thinking about long after the credits rolled.",
    status: "live",
    statusLabel: "Live",
    href: "https://vn-finder.vercel.app",
    placement: "compass",
    compassDirection: "east",
  },
  sw: {
    key: "sw",
    eyebrow: "the scribe · parser",
    title: "Summoners War Parser",
    nature: "Its true name: reading the runes of a save file.",
    desc: "Upload your Summoners War save file and inspect runes, monsters, and artifacts. The parser reads the JSON export and turns it into a browsable web dashboard.",
    status: "live",
    statusLabel: "Live",
    href: "https://sw-parser.vercel.app",
    placement: "compass",
    compassDirection: "south",
  },
  reddit: {
    key: "reddit",
    eyebrow: "the scout · growth",
    title: "Reddit Explorer",
    nature: "Its true name: finding the posts worth your voice.",
    desc: "Set your interests and a schema for what good karma candidates look like. The explorer scans communities and proposes the posts most likely to reward a genuine reply — no ghostwritten comments, just a shorter list of better places to show up.",
    status: "live",
    statusLabel: "Live",
    href: "https://reddit-explorer-rouge.vercel.app",
    placement: "workbench",
    featuredAt: "2026-07-14",
  },
};

export const COMPASS_ORDER: CompassDirection[] = ["north", "east", "south", "west"];

export function getCompassTools(): Tool[] {
  return COMPASS_ORDER.map(
    (dir) =>
      Object.values(TOOLS).find((t) => t.placement === "compass" && t.compassDirection === dir)!
  );
}

export function getWorkbenchTool(): Tool | null {
  return Object.values(TOOLS).find((t) => t.placement === "workbench") || null;
}

export function getCatalogueTools(): Tool[] {
  return Object.values(TOOLS).filter(
    (t) => t.placement === "catalogue" || t.placement === "workbench"
  );
}

export function getActiveTools(): Tool[] {
  return Object.values(TOOLS).filter((t) => t.placement !== "archive");
}
