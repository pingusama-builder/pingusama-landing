import { describe, it, expect, vi, beforeEach } from "vitest"

// Fetch is mocked so we can assert the request body uses opts.model when provided.
const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal("fetch", fetchMock)

import { mistralTurn } from "@/lib/chat/mistral"

describe("mistral client — per-call model override", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    process.env.MISTRAL_API_KEY = "test-key"
    process.env.MISTRAL_MODEL = "mistral-medium-latest"
  })

  it("sends opts.model when provided (overrides MISTRAL_MODEL)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    await mistralTurn({ messages: [{ role: "user", content: "hi" }], model: "mistral-large-latest" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe("mistral-large-latest")
  })

  it("falls back to MISTRAL_MODEL when opts.model is absent", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    await mistralTurn({ messages: [{ role: "user", content: "hi" }] })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe("mistral-medium-latest")
  })
})