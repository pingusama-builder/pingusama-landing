"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  listThreadsAction,
  getThreadAction,
  type ThreadSummary,
} from "@/app/admin/chat/actions";

interface UIMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  streaming?: boolean;
}

export default function ChatUI({ initialThreads }: { initialThreads: ThreadSummary[] }) {
  const [threads, setThreads] = useState<ThreadSummary[]>(initialThreads);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolLog, setToolLog] = useState<string[]>([]);
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
      const { messages: rows } = await getThreadAction(id);
      setMessages(
        rows.map((r) => ({
          id: r.id,
          role: (r.role === "tool" ? "tool" : (r.role as "user" | "assistant")) as UIMessage["role"],
          content: r.content ?? "",
          toolName:
            r.role === "tool"
              ? ((r.tool_calls as { name?: string } | null)?.name ?? "tool")
              : undefined,
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
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    setStreaming(true);
    setToolLog([]);

    const userMsg: UIMessage = { id: nextId(), role: "user", content: text };
    const assistantMsg: UIMessage = { id: nextId(), role: "assistant", content: "", streaming: true };
    setMessages((m) => [...m, userMsg, assistantMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: activeId, message: text }),
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
          case "content": {
            const delta = (evt.delta as string) ?? "";
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") last.content += delta;
              return next;
            });
            break;
          }
          case "tool": {
            const name = (evt.name as string) ?? "tool";
            const status = (evt.status as string) ?? "";
            setToolLog((l) => [...l, `${name} · ${status}`]);
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
                <div className="chat-msg-role">{m.role === "user" ? "you" : "companion"}</div>
                <div className="chat-msg-body">
                  {m.content || (m.streaming ? <span className="chat-typing">…</span> : "")}
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
          <button className="chat-send" onClick={send} disabled={streaming || !input.trim()}>
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </section>
    </div>
  );
}