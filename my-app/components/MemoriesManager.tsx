"use client";

import { useState, useTransition } from "react";
import {
  setMemoryActiveAction,
  updateMemoryContentAction,
  refreshAwarenessAction,
  listMemoriesAction,
} from "@/app/admin/chat/actions";
import type { MemoryRow, MemoryType } from "@/lib/db/chat";

const TYPES: MemoryType[] = ["user", "feedback", "project", "reference", "idea", "site"];

export default function MemoriesManager({ initialMemories }: { initialMemories: MemoryRow[] }) {
  const [memories, setMemories] = useState<MemoryRow[]>(initialMemories);
  const [filter, setFilter] = useState<MemoryType | "all" | "personal" | "site">("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const reload = () =>
    startTransition(async () => {
      const fresh = await listMemoriesAction({});
      setMemories(fresh);
    });

  const filtered = memories.filter((m) => {
    if (filter === "all") return true;
    if (filter === "personal") return m.type !== "site";
    if (filter === "site") return m.type === "site";
    return m.type === filter;
  });

  const byType = (t: MemoryType) => filtered.filter((m) => m.type === t);

  const startEdit = (m: MemoryRow) => {
    setEditing(m.id);
    setDraftContent(m.content);
    setDraftDesc(m.description);
  };

  const save = (id: string) =>
    startTransition(async () => {
      const res = await updateMemoryContentAction(id, {
        content: draftContent,
        description: draftDesc,
      });
      setStatus(res.success ? "Saved." : `Error: ${res.error}`);
      setEditing(null);
      await reload();
    });

  const toggle = (id: string, active: boolean) =>
    startTransition(async () => {
      await setMemoryActiveAction(id, active);
      await reload();
    });

  const refresh = (category?: "blog" | "shelf" | "vault" | "tools" | "code") =>
    startTransition(async () => {
      const res = await refreshAwarenessAction(category);
      setStatus(
        res.success
          ? `Refreshed: ${res.results
              .map((r) => `${r.category} ${r.changed ? "(changed)" : "(unchanged)"}`)
              .join(", ")}`
          : `Error: ${res.error}`
      );
      await reload();
    });

  const renderCard = (m: MemoryRow) => {
    const siteCat = m.name.startsWith("site:") ? m.name.slice(5) : null;
    return (
      <div key={m.id} className={`mem-card${m.active ? "" : " inactive"}`}>
        <div className="mem-card-head">
          <span className="mem-name">{m.name}</span>
          <span className="mem-type-pill">{m.type}</span>
          {siteCat && <span className="mem-cat">category: {siteCat}</span>}
          {!m.active && <span className="mem-inactive-tag">inactive</span>}
        </div>
        <div className="mem-desc">{m.description}</div>
        {editing === m.id ? (
          <div className="mem-edit">
            <textarea
              className="mem-edit-desc"
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              rows={1}
              placeholder="One-line description"
            />
            <textarea
              className="mem-edit-content"
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={6}
            />
            <div className="mem-edit-actions">
              <button className="mem-btn" onClick={() => save(m.id)} disabled={pending}>
                Save
              </button>
              <button className="mem-btn ghost" onClick={() => setEditing(null)} disabled={pending}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <pre className="mem-content">{m.content}</pre>
            {m.links && m.links.length > 0 && (
              <div className="mem-links">links: {m.links.map((l) => `[[${l}]]`).join(" ")}</div>
            )}
            <div className="mem-card-foot">
              <span className="mem-meta">
                {m.last_synced_at ? `synced ${m.last_synced_at.slice(0, 10)} · ` : ""}
                updated {m.updated_at.slice(0, 10)}
              </span>
              <div className="mem-actions">
                <button className="mem-btn ghost" onClick={() => startEdit(m)} disabled={pending}>
                  Edit
                </button>
                <button
                  className="mem-btn ghost"
                  onClick={() => toggle(m.id, !m.active)}
                  disabled={pending}
                >
                  {m.active ? "Deactivate" : "Activate"}
                </button>
                {siteCat && (
                  <button
                    className="mem-btn ghost"
                    onClick={() => refresh(siteCat as "blog" | "shelf" | "vault" | "tools" | "code")}
                    disabled={pending}
                  >
                    Refresh
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="mem-manager">
      <div className="mem-toolbar">
        <div className="mem-filters">
          {(["all", "personal", "site", ...TYPES] as const).map((f) => (
            <button
              key={f}
              className={`mem-filter${filter === f ? " active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <button className="mem-btn" onClick={() => refresh(undefined)} disabled={pending}>
          Refresh all site awareness
        </button>
      </div>

      {status && <div className="mem-status">{status}</div>}

      {filtered.length === 0 && (
        <div className="mem-empty">
          No memories here yet. Chat with the companion and it will save what&apos;s
          worth keeping.
        </div>
      )}

      {TYPES.map((t) => (byType(t).length > 0 ? <section key={t} className="mem-group"><h3 className="mem-group-title">{t} <span className="mem-group-count">{byType(t).length}</span></h3>{byType(t).map(renderCard)}</section> : null))}
    </div>
  );
}