import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchCoverBytes } from "@/lib/covers";

const BOOK = { googleBooksId: "yoHbJ78JZCYC", isbn13: "9780307473394" };

describe("fetchCoverBytes", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  function imageResponse(bytes: number[], mimeType = "image/jpeg", status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? mimeType : null,
      },
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
      bytes: async () => Uint8Array.from(bytes),
    } as unknown as Response;
  }

  function pngHeader(width: number, height: number, colorType: number, bitDepth = 8) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    const ihdrLen = [0, 0, 0, 13];
    const ihdrType = [73, 72, 68, 82];
    const w = [(width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff];
    const h = [(height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff];
    const rest = [bitDepth, colorType, 0, 0, 0];
    const crc = [0, 0, 0, 0];
    return [...sig, ...ihdrLen, ...ihdrType, ...w, ...h, ...rest, ...crc];
  }

  it("tries the Google zoom=0 https URL first and returns its bytes", async () => {
    const fakeBytes = Array.from({ length: 4000 }, (_, i) => i % 256);
    vi.mocked(fetch).mockResolvedValue(imageResponse(fakeBytes, "image/jpeg"));

    const result = await fetchCoverBytes(BOOK);
    expect(result?.source).toBe("google");
    expect(result?.mimeType).toBe("image/jpeg");
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("https://books.google.com/books/content");
    expect(url).toContain("id=yoHbJ78JZCYC");
    expect(url).toContain("zoom=0");
  });

  it("falls back to Open Library when Google returns a non-image / 404", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404, headers: { get: () => null } } as unknown as Response)
      .mockResolvedValueOnce(imageResponse(Array.from({ length: 5000 }, () => 1), "image/jpeg"));

    const result = await fetchCoverBytes(BOOK);
    expect(result?.source).toBe("openlibrary");
    const olUrl = vi.mocked(fetch).mock.calls[1][0] as string;
    expect(olUrl).toBe("https://covers.openlibrary.org/b/isbn/9780307473394/L.jpg");
  });

  it("rejects the Open Library 1x1 not-found placeholder (<1000 bytes)", async () => {
    const tiny = Array.from({ length: 800 }, () => 0);
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404, headers: { get: () => null } } as unknown as Response)
      .mockResolvedValueOnce(imageResponse(tiny, "image/jpeg"));

    const result = await fetchCoverBytes(BOOK);
    expect(result).toBeNull();
  });

  it("rejects the Google Books 575x750 grayscale placeholder and falls back to Open Library", async () => {
    const placeholder = pngHeader(575, 750, 0);
    vi.mocked(fetch)
      .mockResolvedValueOnce(imageResponse(placeholder, "image/png"))
      .mockResolvedValueOnce(imageResponse(Array.from({ length: 5000 }, () => 1), "image/jpeg"));

    const result = await fetchCoverBytes(BOOK);
    expect(result?.source).toBe("openlibrary");
  });

  it("returns null when both sources fail", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, headers: { get: () => null } } as unknown as Response);
    const result = await fetchCoverBytes(BOOK);
    expect(result).toBeNull();
  });
});