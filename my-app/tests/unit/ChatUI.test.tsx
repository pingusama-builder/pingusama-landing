import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatUI from "@/components/ChatUI";

// Server actions imported by ChatUI are mocked at the module boundary so this
// static render test never hits the network or the database.
vi.mock("@/app/admin/chat/actions", () => ({
  listThreadsAction: vi.fn(async () => []),
  getThreadAction: vi.fn(async () => ({ thread: null, messages: [] })),
  setThreadModelPreferenceAction: vi.fn(async () => ({ success: true })),
  inferFromThreadAction: vi.fn(async () => ({ success: true, summary: { saved: [], dropped: 0, skipped: 0, scanned: 0 } })),
}));

const threads = [
  { id: "t1", title: "First chat", messageCount: 2, updated_at: "2026-07-14T10:00:00Z" },
];

describe("ChatUI — web research UI", () => {
  beforeAll(() => {
    // Suppress expected server-render warnings for the client-only transition hook.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the 查公開資料 toggle and source panel placeholders", () => {
    const html = renderToStaticMarkup(<ChatUI initialThreads={threads} />);
    expect(html).toContain("查公開資料");
    expect(html).toContain("chat-web-toggle");
    // The source panel only renders when sources or a status are present.
    expect(html).not.toContain("chat-web-panel");
  });

  it("shows the web-enabled active state class when the toggle is on", () => {
    // The toggle is off by default; we assert the static markup exposes both states.
    const html = renderToStaticMarkup(<ChatUI initialThreads={threads} />);
    expect(html).toContain('class="chat-web-toggle');
    expect(html).toContain('aria-pressed="false"');
  });

  it("component source wires web_phase + readFull + queries and stays free of dangerouslySetInnerHTML (static-grep)", () => {
    const src = readFileSync(fileURLToPath(new URL("../../components/ChatUI.tsx", import.meta.url)), "utf8");
    expect(src).toContain('"web_phase"');
    expect(src).toContain("readFull");
    expect(src).toContain("queries");
    expect(src).toContain("chat-web-phase");
    expect(src).toContain("chat-web-readfull");
    expect(src).not.toContain("dangerouslySetInnerHTML");
  });

  it("wires a three-state webMode toggle (auto/on/off) and sends webMode instead of webEnabled", () => {
    const src = readFileSync(fileURLToPath(new URL("../../components/ChatUI.tsx", import.meta.url)), "utf8");
    expect(src).toMatch(/webMode/);
    expect(src).toMatch(/"auto"|"on"|"off"/);
    // The POST body must send webMode, not the legacy webEnabled boolean.
    expect(src).not.toMatch(/body: JSON\.stringify\(\{[^}]*webEnabled[^}]*\}\)/);
    // Default state is auto (no forced search).
    expect(src).toMatch(/useState<"auto" \| "on" \| "off">\("auto"\)/);
  });
});
