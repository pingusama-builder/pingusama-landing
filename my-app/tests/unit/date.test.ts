import { describe, it, expect, vi, afterEach } from "vitest"
import { formatRelativeDate } from "@/lib/date"

describe("formatRelativeDate", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns 'just now' for very recent dates", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z"))
    expect(formatRelativeDate(new Date("2026-07-08T11:59:59Z"))).toBe("just now")
  })

  it("returns minutes ago", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z"))
    expect(formatRelativeDate(new Date("2026-07-08T11:55:00Z"))).toBe("5m ago")
  })

  it("returns hours ago", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z"))
    expect(formatRelativeDate(new Date("2026-07-08T08:00:00Z"))).toBe("4h ago")
  })

  it("returns days ago", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z"))
    expect(formatRelativeDate(new Date("2026-07-05T12:00:00Z"))).toBe("3d ago")
  })

  it("returns weeks ago", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z"))
    expect(formatRelativeDate(new Date("2026-06-24T12:00:00Z"))).toBe("2w ago")
  })

  it("returns months ago", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z"))
    expect(formatRelativeDate(new Date("2026-04-08T12:00:00Z"))).toBe("3mo ago")
  })

  it("returns years ago", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z"))
    expect(formatRelativeDate(new Date("2023-07-08T12:00:00Z"))).toBe("3y ago")
  })
})
