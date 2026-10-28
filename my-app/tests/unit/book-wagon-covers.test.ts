import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/admin/bench/actions", () => ({ canMoveTbrBooksAction: vi.fn(), moveTbrBookToReadingAction: vi.fn() }));
import BookWagonView from "@/components/BookWagonView";
import type { ResolvedShelf } from "@/lib/books";
import type { BookCoverAsset } from "@/lib/book-cover-types";

const url = "https://storage.example/covers/indie.jpg";
const asset: BookCoverAsset = {
  editionKey: "isbn:9781738401567", status: "available", format: "unreviewed",
  checkedAt: "2026-10-01", url, source: "web", width: 400, height: 400,
};
function render(format = asset.format, status = asset.status) {
  const book = {
    googleBooksId: "indie", title: "50 Indie Games That Changed the World", authors: [],
    isbn13: "9781738401567", isbn10: null, subtitle: null, publisher: null,
    publishedDate: "2025", pageCount: null, infoLink: null, thumbnail: null,
    coverUrl: url, coverSource: null, coverAsset: { ...asset, format, status }, note: "",
  };
  const shelf: ResolvedShelf = { currentlyReading: [book], tbr: [book], errors: [] };
  const html = renderToStaticMarkup(createElement(BookWagonView, { shelf }));
  return [...html.matchAll(/<button\b[^>]*data-(?:wagon|tbr)-book[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
}

it.each(["unreviewed", "product-photo", "flat-front"] as const)(
  "shows a saved %s cover on Reading, the TBR crate and the TBR card",
  format => {
    const buttons = render(format);
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toContain(`src="${url}"`);
      expect(button).not.toContain("平面封面待補");
    }
  },
);
it("uses placeholders when the saved cover is unavailable", () => {
  const buttons = render("unreviewed", "failed");
  expect(buttons).toHaveLength(3);
  for (const button of buttons) expect(button).not.toContain("<img");
});
