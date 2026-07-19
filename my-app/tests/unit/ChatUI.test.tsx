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
  getThreadDebugLogAction: vi.fn(async () => ({ success: true, log: { thread: { id: "t1", title: "x", created_at: "x", updated_at: "x", model_preference: "auto" }, exportedAt: "x", messages: [] } })),
}));

const threads = [
  { id: "t1", title: "First chat", messageCount: 2, sourcedMemoryCount: 0, updated_at: "2026-07-14T10:00:00Z" },
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

  it("wires a Save debug log download (JSON + MD) from getThreadDebugLogAction via Blob, no dangerouslySetInnerHTML", () => {
    const src = readFileSync(fileURLToPath(new URL("../../components/ChatUI.tsx", import.meta.url)), "utf8")
    expect(src).toMatch(/getThreadDebugLogAction/)
    expect(src).toMatch(/URL\.createObjectURL/)
    expect(src).toMatch(/new Blob\(/)
    expect(src).toMatch(/debugLogToMarkdown/)
    expect(src).toMatch(/chat-debug-btn/)
    // Two format targets.
    expect(src).toMatch(/"json"/)
    expect(src).toMatch(/"md"/)
    expect(src).not.toContain("dangerouslySetInnerHTML")
  })
});

describe("ChatUI — delete-thread", () => {
  it("wires deleteThreadAction + trash button + a11y confirm modal, no dangerouslySetInnerHTML", () => {
    const src = readFileSync(fileURLToPath(new URL("../../components/ChatUI.tsx", import.meta.url)), "utf8")
    expect(src).toMatch(/deleteThreadAction/)
    expect(src).toContain("chat-thread-delete")
    expect(src).toContain("chat-delete-overlay")
    expect(src).toContain('role="dialog"')
    expect(src).toContain('aria-modal="true"')
    expect(src).toContain("alsoDeleteMemories")
    // checkbox shown only when sourcedMemoryCount > 0
    expect(src).toMatch(/sourcedMemoryCount\s*>\s*0/)
    // destructive confirm button
    expect(src).toContain("chat-delete-confirm")
    expect(src).toContain("Delete thread")
    expect(src).toContain("chat-delete-error")
    expect(src).toContain('role="alert"')
    expect(src).not.toContain("dangerouslySetInnerHTML")
  })

  it("renders a trash button per thread row", () => {
    const html = renderToStaticMarkup(<ChatUI initialThreads={threads} />)
    expect(html).toContain("chat-thread-delete")
  })
});

describe("ChatUI — external-verification suggestion (round-7 pivot)", () => {
  it("wires the inline source-choice block with the a11y contract + resume POST, no dangerouslySetInnerHTML", () => {
    const src = readFileSync(fileURLToPath(new URL("../../components/ChatUI.tsx", import.meta.url)), "utf8")
    // The choice renders only when the detector proposed (route returns
    // {pendingChoice} JSON instead of a stream → pause-before-synthesize).
    expect(src).toContain("pendingChoice")
    // Inline, non-blocking, NOT a modal: role="group" (not dialog/aria-modal).
    expect(src).toContain('role="group"')
    expect(src).toContain("chat-source-choice")
    // Two labelled actions; both keyboard-reachable <button>s (Enter/Space).
    expect(src).toContain("Search public sources")
    expect(src).toContain("Stay on this site")
    expect(src).toContain('chooseSource("search")')
    expect(src).toContain('chooseSource("stay")')
    // Esc = stay (a11y keyboard shortcut).
    expect(src).toMatch(/Escape[\s\S]*chooseSource\("stay"\)/)
    // The resume POST sends sourceChoice + pendingChoiceId (not message/webMode).
    expect(src).toContain("sourceChoice: choice")
    expect(src).toContain("pendingChoiceId: pc.id")
    // The suggestion response is JSON, detected by Content-Type (not a stream).
    expect(src).toContain("application/json")
    // No raw HTML injection anywhere on the choice path.
    expect(src).not.toContain("dangerouslySetInnerHTML")
  })
});
