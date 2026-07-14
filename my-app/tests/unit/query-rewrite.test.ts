import { describe, it, expect } from "vitest"
import { parseRewriteJson, normalizeRewrite } from "@/lib/chat/query-rewrite"

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
})

describe("normalizeRewrite", () => {
  const fallback = "2025-2026他有講AI內容?"

  it("uses the parsed query and subject", () => {
    expect(
      normalizeRewrite({ query: "Dan Koe AI 2025 2026", subject: "Dan Koe" }, fallback)
    ).toEqual({ query: "Dan Koe AI 2025 2026", subject: "Dan Koe" })
  })

  it("falls back to the raw message when query is missing/empty", () => {
    expect(normalizeRewrite({ query: "", subject: "Dan Koe" }, fallback)).toEqual({
      query: fallback,
      subject: "Dan Koe",
    })
    expect(normalizeRewrite({ subject: "Dan Koe" }, fallback)).toEqual({
      query: fallback,
      subject: "Dan Koe",
    })
  })

  it("treats a null-ish subject string as null", () => {
    expect(normalizeRewrite({ query: "q", subject: "null" }, fallback).subject).toBeNull()
    expect(normalizeRewrite({ query: "q", subject: "  " }, fallback).subject).toBeNull()
    expect(normalizeRewrite({ query: "q", subject: null }, fallback).subject).toBeNull()
  })

  it("trims and caps overly-long values", () => {
    const longQuery = "x".repeat(300)
    const longSubject = "y".repeat(100)
    const out = normalizeRewrite({ query: longQuery, subject: longSubject }, fallback)
    expect(out.query.length).toBe(200)
    expect(out.subject?.length).toBe(80)
  })

  it("falls back fully when parsed is null", () => {
    expect(normalizeRewrite(null, fallback)).toEqual({ query: fallback, subject: null })
  })
})