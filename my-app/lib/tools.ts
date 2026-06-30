export type ToolKey = "epub" | "vn" | "sw" | "words";

export interface Tool {
  eyebrow: string;
  title: string;
  nature: string;
  desc: string;
  status: string;
  statusKind: "live" | "local" | "wip";
  href: string;
}

export const TOOLS: Record<ToolKey, Tool> = {
  epub: {
    eyebrow: "the tamer · converter",
    title: "sim2trad 簡繁書轉換",
    nature:
      "你愛讀《凡人修仙傳》、《詭秘之主》但不喜歡簡體字？ Me too。所以我寫了這個，專為超大網絡小說而設的轉換器，連目錄一起。",
    desc: "Upload EPUB, DOCX, or TXT novels in Simplified Chinese and get split, converted Traditional Chinese output (s2t / s2hk / s2tw / s2twp) as real EPUB or TXT files. MOBI and AZW3 are not supported.",
    status: "Live",
    statusKind: "live",
    href: "https://sim2trad-ebook-converter.vercel.app",
  },
  words: {
    eyebrow: "the keeper · vocab",
    title: "Name of the Words",
    nature: "Its true name: catching the words you almost let go.",
    desc: "A pocket vocabulary app. Save a word today, see it again tomorrow, let the ones that matter root themselves and forget the rest.",
    status: "Live",
    statusKind: "live",
    href: "https://words.yourdomain.com",
  },
  vn: {
    eyebrow: "the compass · discovery",
    title: "VN Finder",
    nature: "Its true name: a small map of stories I kept replaying.",
    desc: "Look up visual novels by character, route, or scene. Built from the data of games I couldn't stop thinking about long after the credits rolled.",
    status: "Live",
    statusKind: "live",
    href: "https://vn-finder.vercel.app",
  },
  sw: {
    eyebrow: "the scribe · parser",
    title: "Summoners War Parser",
    nature: "Its true name: reading the runes of a save file.",
    desc: "Upload your Summoners War save file and inspect runes, monsters, and artifacts. The parser reads the JSON export and turns it into a browsable web dashboard.",
    status: "Live",
    statusKind: "live",
    href: "https://sw-parser.vercel.app",
  },
};
