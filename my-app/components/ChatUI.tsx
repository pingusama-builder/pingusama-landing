"use client";

import { useState, useRef, useCallback, useEffect, useTransition } from "react";
import {
  listThreadsAction,
  getThreadAction,
  setThreadModelPreferenceAction,
  inferFromThreadAction,
  getThreadDebugLogAction,
  type ThreadSummary,
} from "@/app/admin/chat/actions";
import type { ModelPreference } from "@/lib/chat/models";
import { appendAssistantDelta } from "@/lib/chat/stream-updater";
import { MarkdownText } from "@/components/MarkdownText";
import type { WebSource } from "@/lib/chat/tavily-search";
import { debugLogToMarkdown } from "@/lib/chat/debug-log";

interface UIMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  streaming?: boolean;
  model?: string | null;
}

function filenameStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export default function ChatUI({ initialThreads }: { initialThreads: ThreadSummary[] }) {
  const [threads, setThreads] = useState<ThreadSummary[]>(initialThreads);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolLog, setToolLog] = useState<string[]>([]);
  const [modelPref, setModelPref] = useState<ModelPreference>("auto");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [liveModel, setLiveModel] = useState<string | null>(null); // tier shown while streaming
  const [inferPending, startInferTransition] = useTransition();
  const [inferStatus, setInferStatus] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [webMode, setWebMode] = useState<"auto" | "on" | "off">("auto");
  const [webSources, setWebSources] = useState<WebSource[]>([]);
  const [webQuery, setWebQuery] = useState<string | null>(null);
  const [webStatus, setWebStatus] = useState<{
    status: "empty" | "unavailable" | "subject_absent";
    reason?: string;
    subject?: string;
    query?: string;
  } | null>(null);
  const [webPhase, setWebPhase] = useState<string | null>(null);
  const [webQueries, setWebQueries] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  const nextId = () => `m${++idCounter.current}`;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, toolLog]);

  const openThread = useCallback(
    async (id: string) => {
      setActiveId(id);
      setError(null);
      setToolLog([]);
      setLiveModel(null);
      setWebSources([]);
      setWebQuery(null);
      setWebStatus(null);
      setWebPhase(null);
      setWebQueries([]);
      const { thread, messages: rows } = await getThreadAction(id);
      setModelPref(thread?.model_preference ?? "auto");
      setMessages(
        rows.map((r) => ({
          id: r.id,
          role: (r.role === "tool" ? "tool" : (r.role as "user" | "assistant")) as UIMessage["role"],
          content: r.content ?? "",
          toolName:
            r.role === "tool"
              ? ((r.tool_calls as { name?: string } | null)?.name ?? "tool")
              : undefined,
          model: r.role === "assistant" ? r.model ?? null : null,
        }))
      );
    },
    []
  );

  const newConversation = () => {
    setActiveId(null);
    setMessages([]);
    setToolLog([]);
    setError(null);
    setModelPref("auto");
    setLiveModel(null);
    setWebMode("auto");
    setWebSources([]);
    setWebQuery(null);
    setWebStatus(null);
    setWebPhase(null);
    setWebQueries([]);
  };

  const inferNow = () => {
    if (!activeId || streaming || inferPending) return;
    setInferStatus(null);
    startInferTransition(async () => {
      const res = await inferFromThreadAction(activeId);
      if (!res.success) {
        setInferStatus(`Error: ${res.error}`);
        return;
      }
      const { saved, dropped, skipped, scanned } = res.summary;
      if (scanned === 0) {
        setInferStatus("No new messages since last save.");
        return;
      }
      if (saved.length === 0) {
        setInferStatus("No new memories worth keeping.");
        return;
      }
      const names = saved.map((s) => s.name).join(", ");
      setInferStatus(
        `Saved ${saved.length} memories: ${names}.${dropped ? ` Dropped ${dropped}.` : ""}${
          skipped ? ` Skipped ${skipped}.` : ""
        }`
      );
    });
  };

  const downloadDebugLog = async (format: "json" | "md") => {
    if (!activeId || downloading) return;
    setDownloading(true);
    try {
      const res = await getThreadDebugLogAction(activeId);
      if (!res.success) {
        setError(res.error);
        return;
      }
      const stamp = filenameStamp();
      const blob =
        format === "json"
          ? new Blob([JSON.stringify(res.log, null, 2)], { type: "application/json" })
          : new Blob([debugLogToMarkdown(res.log)], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-${res.log.thread.id}-${stamp}.${format === "json" ? "json" : "md"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    setStreaming(true);
    setToolLog([]);
    setWebSources([]);
    setWebQuery(null);
    setWebStatus(null);
    setWebPhase(null);
    setWebQueries([]);

    const userMsg: UIMessage = { id: nextId(), role: "user", content: text };
    const assistantMsg: UIMessage = { id: nextId(), role: "assistant", content: "", streaming: true };
    setMessages((m) => [...m, userMsg, assistantMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: activeId, message: text, webMode }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Request failed (${res.status}): ${errText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let threadId = activeId;

      const handleEvent = (payload: string) => {
        if (!payload) return;
        let evt: { type: string; [k: string]: unknown };
        try {
          evt = JSON.parse(payload);
        } catch {
          return;
        }
        switch (evt.type) {
          case "thread":
            threadId = (evt.threadId as string) ?? threadId;
            break;
          case "model": {
            const tier = (evt.tier as string) ?? null;
            setLiveModel(tier);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                last.model = (evt.modelId as string) ?? last.model;
              }
              return next;
            });
            break;
          }
          case "content": {
            const delta = (evt.delta as string) ?? "";
            setMessages((prev) => appendAssistantDelta(prev, "content", delta));
            break;
          }
          case "tool": {
            const name = (evt.name as string) ?? "tool";
            const status = (evt.status as string) ?? "";
            setToolLog((l) => [...l, `${name} · ${status}`]);
            break;
          }
          case "web_phase": {
            setWebPhase((evt.phase as string) ?? null);
            break;
          }
          case "web_sources": {
            setWebQuery((evt.query as string) ?? null);
            setWebSources((evt.sources as WebSource[]) ?? []);
            setWebQueries((evt.queries as string[]) ?? []);
            break;
          }
          case "web_status": {
            setWebStatus({
              status: evt.status as "empty" | "unavailable" | "subject_absent",
              reason: (evt.reason as string) ?? undefined,
              subject: (evt.subject as string) ?? undefined,
              query: (evt.query as string) ?? undefined,
            });
            break;
          }
          case "done":
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last) last.streaming = false;
              return next;
            });
            break;
          case "error":
            setError((evt.message as string) ?? "Chat error");
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant" && last.content === "") {
                next.pop();
              } else if (last) {
                last.streaming = false;
              }
              return next;
            });
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line.startsWith("data:")) handleEvent(line.slice(5).trim());
        }
      }
      if (buffer.startsWith("data:")) handleEvent(buffer.slice(5).trim());

      // Refresh thread list + activate the (possibly new) thread.
      if (threadId && threadId !== activeId) {
        setActiveId(threadId);
      }
      setThreads(await listThreadsAction());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Send failed";
      setError(msg);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && last.content === "") next.pop();
        else if (last) last.streaming = false;
        return next;
      });
    } finally {
      setStreaming(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="chat-shell">
      <aside className="chat-threads">
        <button className="chat-new" onClick={newConversation} disabled={streaming}>
          + New conversation
        </button>
        <ul>
          {threads.length === 0 && (
            <li className="chat-threads-empty">No conversations yet.</li>
          )}
          {threads.map((t) => (
            <li key={t.id}>
              <button
                className={`chat-thread-btn${t.id === activeId ? " active" : ""}`}
                onClick={() => openThread(t.id)}
                disabled={streaming}
              >
                <span className="chat-thread-title">{t.title}</span>
                <span className="chat-thread-meta">{t.messageCount} msgs</span>
              </button>
            </li>
          ))}
        </ul>
        <a className="chat-mem-link" href="/admin/chat/memories">
          Manage memories →
        </a>
      </aside>

      <section className="chat-main">
        <div className="chat-head">
          <div className="chat-model-pill-wrap">
            <button
              type="button"
              className="chat-model-pill"
              onClick={() => setModelMenuOpen((o) => !o)}
              disabled={streaming || !activeId}
              aria-haspopup="menu"
              aria-expanded={modelMenuOpen}
              title="Change the Mistral model for this thread"
            >
              Model: {modelPref === "auto" ? `auto → ${liveModel ?? "medium"}` : modelPref}
            </button>
            {modelMenuOpen && (
              <div className="chat-model-menu" role="menu">
                {(["auto", "small", "medium", "large"] as ModelPreference[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`chat-model-option${p === modelPref ? " active" : ""}`}
                    role="menuitem"
                    onClick={async () => {
                      if (!activeId) return;
                      setModelMenuOpen(false);
                      const prev = modelPref;
                      setModelPref(p);
                      const res = await setThreadModelPreferenceAction(activeId, p);
                      if (!res.success) {
                        setModelPref(prev);
                        setError(res.error);
                      }
                    }}
                  >
                    {p}
                    {p === "auto" ? " (route by difficulty)" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="chat-infer-btn"
            onClick={inferNow}
            disabled={streaming || !activeId || inferPending}
            title="Read this conversation and save durable memories to the bank"
          >
            {inferPending ? "Inferring…" : "Save memories now"}
          </button>
          <button
            type="button"
            className="chat-debug-btn"
            onClick={() => downloadDebugLog("json")}
            disabled={streaming || !activeId || downloading}
            title="Download this thread's full transcript + the model's reasoning (JSON)"
          >
            {downloading ? "…" : "⬇ JSON"}
          </button>
          <button
            type="button"
            className="chat-debug-btn"
            onClick={() => downloadDebugLog("md")}
            disabled={streaming || !activeId || downloading}
            title="Download this thread's full transcript + the model's reasoning (Markdown)"
          >
            {downloading ? "…" : "⬇ MD"}
          </button>
        </div>

        {inferStatus && <div className="chat-infer-status">{inferStatus}</div>}

        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <p className="chat-empty-title">Ask the companion.</p>
              <p className="chat-empty-hint">
                It knows this site — the blog, the shelf, the wheel, the vault, the
                code — and remembers what matters across conversations. Admin-only
                pilot: it can save memories and read the site, but it can&apos;t
                edit anything.
              </p>
            </div>
          )}
          {messages.map((m) =>
            m.role === "tool" ? (
              <div key={m.id} className="chat-tool-line">
                <span className="chat-tool-pin" />
                <span>
                  <strong>{m.toolName}</strong> — {m.content}
                </span>
              </div>
            ) : (
              <div key={m.id} className={`chat-msg ${m.role}`}>
                <div className="chat-msg-role">
                  {m.role === "user" ? "you" : "companion"}
                  {m.role === "assistant" && m.model && (
                    <span className="chat-msg-model"> · {m.model.replace("mistral-", "").replace("-latest", "")}</span>
                  )}
                </div>
                <div className="chat-msg-body">
                  {m.role === "assistant"
                    ? m.content
                      ? <MarkdownText>{m.content}</MarkdownText>
                      : (m.streaming ? <span className="chat-typing">…</span> : "")
                    : m.content}
                </div>
              </div>
            )
          )}
          {toolLog.length > 0 && (
            <div className="chat-toollog">
              {toolLog.map((t, i) => (
                <div key={i}>{t}</div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="chat-error">{error}</div>}

        {(webSources.length > 0 || webStatus || (webMode !== "off" && webPhase && webPhase !== "done")) && (
          <div className="chat-web-panel" data-web-status={webStatus?.status ?? "ok"}>
            {webPhase && webPhase !== "done" && (
              <div className="chat-web-phase" aria-live="polite">
                {webPhase === "rewriting"
                  ? "Rewriting the search…"
                  : webPhase === "searching"
                    ? "Searching public sources…"
                    : webPhase === "reading"
                      ? "Reading the top sources…"
                      : ""}
              </div>
            )}
            {webSources.length > 0 && (
              <>
                <div className="chat-web-header">
                  Public sources{webQuery ? ` for “${webQuery}”` : ""}
                </div>
                {webQueries.length > 0 && (
                  <div className="chat-web-queries">Queries: {webQueries.join(" · ")}</div>
                )}
                <ul className="chat-web-list">
                  {webSources.map((s, i) => (
                    <li key={`${s.url}-${i}`} className="chat-web-item">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="chat-web-link"
                      >
                        {s.title || s.domain}
                      </a>
                      <span className="chat-web-domain"> · {s.domain}</span>
                      {(s as WebSource & { readFull?: boolean }).readFull && (
                        <span className="chat-web-readfull"> · read in full</span>
                      )}
                      {s.snippet && <p className="chat-web-snippet">{s.snippet}</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {webStatus && (
              <div className={`chat-web-status chat-web-status-${webStatus.status}`}>
                {webStatus.status === "empty"
                  ? "No public web results found."
                  : webStatus.status === "subject_absent"
                    ? `Public sources found, but none mention “${webStatus.subject ?? "the subject"}” — the answer below will say it could not confirm from the web.`
                    : `Web search unavailable${webStatus.reason ? `: ${webStatus.reason}` : "."}`}
              </div>
            )}
          </div>
        )}

        <div className="chat-composer">
          <textarea
            className="chat-input"
            placeholder="Ask anything — about the site, or anything else…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            disabled={streaming}
          />
          <button
            type="button"
            className={`chat-web-toggle${webMode !== "auto" ? " active" : ""}`}
            onClick={() => setWebMode((m) => (m === "auto" ? "on" : m === "on" ? "off" : "auto"))}
            disabled={streaming}
            aria-pressed={webMode === "on"}
            aria-label={`Web search: ${webMode}`}
            title={`Web search: ${webMode} (auto / on / off)`}
          >
            查公開資料：{webMode}
          </button>
          <button className="chat-send" onClick={send} disabled={streaming || !input.trim()}>
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </section>
    </div>
  );
}