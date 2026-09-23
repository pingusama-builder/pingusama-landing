import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { fetchCoverBytes } from "@/lib/covers";

import sharp from "sharp";
let validBytes: number[];
beforeAll(async()=>{ validBytes=[...await sharp(Buffer.from(Array.from({length:120*180*3},(_,i)=>(i*37)%251)),{raw:{width:120,height:180,channels:3}}).jpeg({quality:90}).toBuffer()]; });

const BOOK = { googleBooksId: "yoHbJ78JZCYC", isbn13: "9780307473394" };

describe("fetchCoverBytes", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  function imageResponse(bytes: number[], mimeType = "image/jpeg", status = 200) {
    return new Response(Uint8Array.from(bytes), {status,headers:{"content-type":mimeType}});
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
    const fakeBytes = validBytes;
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
      .mockResolvedValueOnce(imageResponse(validBytes, "image/jpeg"));

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
    const placeholder = [...pngHeader(575, 750, 0), ...Array(1500).fill(0)];
    vi.mocked(fetch)
      .mockResolvedValueOnce(imageResponse(placeholder, "image/png"))
      .mockResolvedValueOnce(imageResponse(validBytes, "image/jpeg"));

    const result = await fetchCoverBytes(BOOK);
    expect(result?.source).toBe("openlibrary");
  });

  it("returns null when both sources fail", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, headers: { get: () => null } } as unknown as Response);
    const result = await fetchCoverBytes(BOOK);
    expect(result).toBeNull();
  });

  it("tries the Open Library cover-by-ID URL ahead of the ISBN-keyed URL", async () => {
    const olIdUrl = "https://covers.openlibrary.org/b/id/14813663-L.jpg";
    vi.mocked(fetch)
      // google cover: not found
      .mockResolvedValueOnce({ ok: false, status: 404, headers: { get: () => null } } as unknown as Response)
      // OL cover-by-ID: real image
      .mockResolvedValueOnce(imageResponse(validBytes, "image/jpeg"));

    const result = await fetchCoverBytes({ ...BOOK, olCoverUrl: olIdUrl });
    expect(result?.source).toBe("openlibrary");
    const usedUrl = vi.mocked(fetch).mock.calls[1][0] as string;
    expect(usedUrl).toBe(olIdUrl);
    // ISBN-keyed URL never reached because the ID URL succeeded.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("does not build a Google cover URL for an ol:-prefixed id", async () => {
    const olIdUrl = "https://covers.openlibrary.org/b/id/8782784-L.jpg";
    vi.mocked(fetch).mockResolvedValue(
      imageResponse(validBytes, "image/jpeg")
    );

    await fetchCoverBytes({ googleBooksId: "ol:OL27311435M", isbn13: "9780143111610", olCoverUrl: olIdUrl });
    const firstUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(firstUrl).toBe(olIdUrl);
    expect(firstUrl).not.toContain("books.google.com");
  });
});
it("rejects bytes that claim to be an image but cannot decode",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>new Response(new Uint8Array(2000),{headers:{"content-type":"image/jpeg"}})));
 expect(await fetchCoverBytes(BOOK)).toBeNull();vi.unstubAllGlobals();
});
it("does not fetch a client supplied non-provider URL or synthetic Google id",async()=>{
 vi.stubGlobal("fetch",vi.fn());
 expect(await fetchCoverBytes({googleBooksId:"web:9780307473394",isbn13:null,olCoverUrl:"http://127.0.0.1/private"})).toBeNull();
 expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();
});
it("rejects oversized images before reading the payload",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>new Response(new Uint8Array(100),{headers:{"content-type":"image/jpeg","content-length":"4000000"}})));
 expect(await fetchCoverBytes(BOOK)).toBeNull();vi.unstubAllGlobals();
});
it("decodes an allowlisted image even when its CDN omits content-type",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>new Response(Uint8Array.from(validBytes))));
 const image=await fetchCoverBytes(BOOK);expect(image).toMatchObject({mimeType:"image/jpeg",width:120,height:180});vi.unstubAllGlobals();
});
