import type { ShelfEntry } from "./books";
import type { BenchEvent } from "./bench-diagnostics";

export type ShelfSection = "currentlyReading" | "tbr";
export type BookAddStep = "metadata" | "edition" | "cover" | "save";
export const bookAddSteps: Record<BookAddStep, string> = {
  metadata: "核對書籍資料", edition: "確認所選版本", cover: "取得及核對封面", save: "保存及同步書架",
};
export interface BookAddInput { section: ShelfSection; entry: ShelfEntry; }
export interface BookAddProgress {
  type: "progress"; step: BookAddStep; status: "running" | "done" | "warning"; message: string;
}
export type BookAddResult =
  | { type: "result"; success: true; entry: ShelfEntry; warnings: string[]; alreadyPresent: boolean }
  | { type: "result"; success: false; error: string };
export type BookAddEvent = BookAddProgress | { type: "trace"; event: BenchEvent } | BookAddResult;
