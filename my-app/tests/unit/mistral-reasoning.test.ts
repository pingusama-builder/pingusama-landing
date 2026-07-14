import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mistralTurn } from "@/lib/chat/mistral"

describe("callMistral — per-call reasoningEffort override", () => {
  const originalFetch = globalThis.fetch
  const originalEnv = { ...process.env }

  function lastBody(): Record<string, unknown> {
    const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
    const init = calls[calls.length - 1][1]
    return JSON.parse(init?.body as string) as Record<string, unknown>
  }

  beforeEach(() => {
    process.env.MISTRAL_API_KEY = "k"
    process.env.COMPANION_REASONING_EFFORT = "high"
    process.env.MISTRAL_REASONING_MODEL = "mistral-medium-3-5"
    delete process.env.OLLAMA_BASE_URL
    delete process.env.COMPANION_NARROW_SUBSTRATE
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] })
      ),
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      }),
    } as unknown as Response)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k]
    for (const [k, v] of Object.entries(originalEnv)) process.env[k] = v as string
    vi.clearAllMocks()
  })

  it("uses the per-call override when the model is reasoning-capable", async () => {
    await mistralTurn({
      model: "mistral-medium-3-5",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "medium",
    })
    expect(lastBody().reasoning_effort).toBe("medium")
  })

  it("falls back to the env effort when no override is passed (advisor path unchanged)", async () => {
    await mistralTurn({
      model: "mistral-medium-3-5",
      messages: [{ role: "user", content: "hi" }],
    })
    expect(lastBody().reasoning_effort).toBe("high")
  })

  it("does NOT send reasoning_effort to a non-reasoning model even if an override is passed", async () => {
    await mistralTurn({
      model: "mistral-large-latest",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "high",
    })
    expect(lastBody().reasoning_effort).toBeUndefined()
  })

  it("sends no reasoning_effort when the env substrate is inactive, even with an override", async () => {
    delete process.env.COMPANION_REASONING_EFFORT
    await mistralTurn({
      model: "mistral-medium-3-5",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "high",
    })
    expect(lastBody().reasoning_effort).toBeUndefined()
  })
})