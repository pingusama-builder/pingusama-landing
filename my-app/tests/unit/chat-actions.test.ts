import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.hoisted(() => ({ requireAdmin: vi.fn(), getCurrentUser: vi.fn(), isAdmin: vi.fn() }))
const chatMock = vi.hoisted(() => ({ setThreadModelPreference: vi.fn() }))
const modelsMock = vi.hoisted(() => ({ MODEL_PREFERENCES: ["auto", "small", "medium", "large"] }))

vi.mock("@/lib/auth", () => ({
  requireAdmin: authMock.requireAdmin,
  getCurrentUser: authMock.getCurrentUser,
  isAdmin: authMock.isAdmin,
}))
vi.mock("@/lib/db/chat", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/chat")>("@/lib/db/chat")
  return { ...actual, setThreadModelPreference: chatMock.setThreadModelPreference }
})
vi.mock("@/lib/chat/awareness", () => ({ refreshAwareness: vi.fn(), SiteCategory: undefined }))
vi.mock("@/lib/chat/models", () => ({ MODEL_PREFERENCES: modelsMock.MODEL_PREFERENCES }))

import { setThreadModelPreferenceAction } from "@/app/admin/chat/actions"

describe("setThreadModelPreferenceAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes a valid preference after requireAdmin", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    chatMock.setThreadModelPreference.mockResolvedValue(undefined)
    const res = await setThreadModelPreferenceAction("t1", "large")
    expect(res.success).toBe(true)
    expect(chatMock.setThreadModelPreference).toHaveBeenCalledWith("t1", "large")
  })

  it("rejects an invalid preference without touching the DB", async () => {
    authMock.requireAdmin.mockResolvedValue({ id: "admin-1" })
    const res = await setThreadModelPreferenceAction("t1", "enormous" as any)
    expect(res.success).toBe(false)
    expect(chatMock.setThreadModelPreference).not.toHaveBeenCalled()
  })

  it("returns failure if requireAdmin throws", async () => {
    authMock.requireAdmin.mockRejectedValue(new Error("not admin"))
    const res = await setThreadModelPreferenceAction("t1", "small")
    expect(res.success).toBe(false)
  })
})