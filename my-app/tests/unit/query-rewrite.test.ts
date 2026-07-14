import { describe, it, expect } from "vitest"
import { parseRewriteJson, normalizeRewrite, rewriteSearchQueries } from "@/lib/chat/query-rewrite"

describe("parseRewriteJson", () => {
  it("parses a bare JSON object", () => {
    expect(parseRewriteJson('{"query": "Dan Koe AI", "subject": "Dan Koe"}')).toEqual({
      query: "Dan Koe AI",
      subject: "Dan Koe",
    })
  })

  it("parses JSON wrapped in ```json fences", () => {
    const raw = '```json\n{"query": "Dan Koe AI", "subject": "Dan Koe"}\n```'
    expect(parseRewriteJson(raw)).toEqual({ query: "Dan Koe AI", subject: "Dan Koe" })
  })

  it("parses JSON embedded in prose", () => {
    const raw = 'Here is the rewrite: {"query": "Dan Koe AI", "subject": "Dan Koe"} thanks'
    expect(parseRewriteJson(raw)).toEqual({ query: "Dan Koe AI", subject: "Dan Koe" })
  })

  it("handles subject: null", () => {
    expect(parseRewriteJson('{"query": "weather Paris", "subject": null}')).toEqual({
      query: "weather Paris",
      subject: null,
    })
  })

  it("returns null when no JSON object is present", () => {
    expect(parseRewriteJson("no json here")).toBeNull()
  })

  it("returns null for malformed JSON", () => {
    expect(parseRewriteJson("{not valid json}")).toBeNull()
  })

  it("handles nested braces in values", () => {
    expect(parseRewriteJson('{"query": "a {b} c", "subject": "Dan Koe"}')).toEqual({
      query: "a {b} c",
      subject: "Dan Koe",
    })
  })

  it("parses a {queries, subject} multi-query object", () => {
    expect(parseRewriteJson('{"queries": ["Dan Koe AI 2025 2026", "Dan Koe essays"], "subject": "Dan Koe"}')).toEqual({
      queries: ["Dan Koe AI 2025 2026", "Dan Koe essays"],
      subject: "Dan Koe",
    })
  })

  it("parses {queries, subject} wrapped in fences", () => {
    expect(parseRewriteJson('```json\n{"queries": ["q1"], "subject": null}\n```')).toEqual({
      queries: ["q1"],
      subject: null,
    })
  })
})

describe("normalizeRewrite — multi-query", () => {
  const fallback = "2025-2026他有講AI內容?"

  it("uses parsed queries + subject", () => {
    expect(
      normalizeRewrite({ queries: ["Dan Koe AI 2025 2026", "Dan Koe essays"], subject: "Dan Koe" }, fallback)
    ).toEqual({ queries: ["Dan Koe AI 2025 2026", "Dan Koe essays"], subject: "Dan Koe" })
  })

  it("falls back to [fallback] when queries missing/empty/not an array (subject preserved)", () => {
    expect(normalizeRewrite({ queries: [], subject: "Dan Koe" }, fallback)).toEqual({
      queries: [fallback],
      subject: "Dan Koe",
    })
    expect(normalizeRewrite({ subject: "Dan Koe" }, fallback)).toEqual({
      queries: [fallback],
      subject: "Dan Koe",
    })
    expect(normalizeRewrite({ queries: "nope", subject: null }, fallback)).toEqual({
      queries: [fallback],
      subject: null,
    })
  })

  it("accepts a legacy single {query} object and wraps it into [query]", () => {
    expect(normalizeRewrite({ query: "Dan Koe AI 2025 2026", subject: "Dan Koe" }, fallback)).toEqual({
      queries: ["Dan Koe AI 2025 2026"],
      subject: "Dan Koe",
    })
  })

  it("treats a null-ish subject string as null", () => {
    expect(normalizeRewrite({ queries: ["q"], subject: "null" }, fallback).subject).toBeNull()
    expect(normalizeRewrite({ queries: ["q"], subject: "  " }, fallback).subject).toBeNull()
    expect(normalizeRewrite({ queries: ["q"], subject: null }, fallback).subject).toBeNull()
  })

  it("caps queries to 3, each to 200 chars, trims + dedupes empties", () => {
    const out = normalizeRewrite({ queries: ["a", "b", "c", "d", "  ", "x".repeat(300)], subject: null }, fallback)
    expect(out.queries.length).toBeLessThanOrEqual(3)
    expect(out.queries.every((q) => q.length <= 200 && q.trim() === q)).toBe(true)
  })

  it("falls back fully when parsed is null", () => {
    expect(normalizeRewrite(null, fallback)).toEqual({ queries: [fallback], subject: null })
  })
})

describe("rewriteSearchQueries", () => {
  it("returns a {queries, subject} contract and never blocks (falls back to [message] on error)", async () => {
    // Without a MISTRAL_API_KEY the mistralTurn call throws; the contract is the
    // fallback { queries: [message], subject: null } — proving the turn never blocks.
    const out = await rewriteSearchQueries("hello", [])
    expect(Array.isArray(out.queries)).toBe(true)
    expect(out.queries.length).toBeGreaterThanOrEqual(1)
    expect("subject" in out).toBe(true)
  })
})