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
      arrayBuffer: async () => new ArrayBuffer(bytes.length),
      // covers.ts uses .arrayBuffer() then Buffer.from; emulate byte length
      bytes: async () => Uint8Array.from(bytes),
    } as unknown as Response;
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

  it("returns null when both sources fail", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, headers: { get: () => null } } as unknown as Response);
    const result = await fetchCoverBytes(BOOK);
    expect(result).toBeNull();
  });
});