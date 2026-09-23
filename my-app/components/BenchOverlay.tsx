"use client";

import { useEffect, useRef } from "react";
import BookWagonView from "./BookWagonView";
import type { ResolvedShelf, VaultData } from "@/lib/books";

interface BenchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  shelf: ResolvedShelf;
  vault: VaultData;
}

interface Clip {
  title: string;
  url: string;
  source: string;
  date: string;
  note: string;
}

function useLockBodyScroll(lock: boolean) {
  useEffect(() => {
    if (!lock) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lock]);
}

function useEscapeKey(onClose: () => void, isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("dialog")) return;
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);
}

function useFocusTrap(
  containerRef: React.RefObject<HTMLDivElement | null>,
  isOpen: boolean
) {
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const focusable = Array.from(
      container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ) as HTMLElement[];

    if (focusable.length === 0) return;

    const first = focusable[0];
    first.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("dialog")) return;
      if (e.key !== "Tab") return;
      const current = Array.from(container.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')).filter(el=>el.getClientRects().length>0);
      const first = current[0]; const last = current[current.length-1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handler);
    return () => { document.removeEventListener("keydown", handler);previousFocus?.focus(); };
  }, [isOpen, containerRef]);
}

function ClipRow({ clip }: { clip: Clip }) {
  const hasUrl = clip.url && clip.url.trim() !== "";
  const content = (
    <>
      <span className="bench-clip-pin" aria-hidden="true" />
      <span className="bench-clip-body">
        <span className="bench-clip-title">{clip.title || "Untitled clip"}</span>
        <span className="bench-clip-meta">
          <span className="bench-clip-source">{clip.source || "Unknown source"}</span>
          <span aria-hidden="true">·</span>
          <span>{clip.date || "no date"}</span>
        </span>
        {clip.note && <p className="bench-clip-note">{clip.note}</p>}
      </span>
    </>
  );

  if (!hasUrl) {
    return (
      <div className="bench-clip bench-clip-static" aria-label={clip.title || "Untitled clip"}>
        {content}
      </div>
    );
  }

  return (
    <a
      href={clip.url}
      target="_blank"
      rel="noopener noreferrer"
      className="bench-clip"
      aria-label={clip.title || clip.url}
    >
      {content}
    </a>
  );
}

export default function BenchOverlay({
  isOpen,
  onClose,
  shelf,
  vault,
}: BenchOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const clips: Clip[] = vault.clips;

  useLockBodyScroll(isOpen);
  useEscapeKey(onClose, isOpen);
  useFocusTrap(panelRef, isOpen);


  return (
    <div
      ref={panelRef}
      className={`bench-overlay ${isOpen ? "open" : ""}`}
      inert={!isOpen}
      aria-hidden={!isOpen}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bench-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bench-card" style={{maxWidth:1120}}>
        <h2 id="bench-title" className="visually-hidden">
          The bench — shelf and vault
        </h2>
        <button
          ref={closeRef}
          type="button"
          className="bench-card-close"
          onClick={onClose}
          aria-label="Close bench"
        >
          ×
        </button>

        <div className="bench-grid" style={{display:"block"}}>
          <BookWagonView shelf={shelf}/>
          <div className="bench-section">
            <div className="bench-section-head">
              <h4 id="bench-vault-title">Things worth keeping</h4>
              <span className="bench-count">{clips.length} kept</span>
            </div>

            {clips.length > 0 ? (
              <>
                <div
                  className="bench-clip-stack"
                  aria-labelledby="bench-vault-title"
                >
                  {clips.slice(0, 5).map((clip, i) => (
                    <ClipRow key={`${clip.url || clip.title}-${i}`} clip={clip} />
                  ))}
                </div>
                {clips.length > 5 && (
                  <>
                    <div className="bench-shelf-divider" />
                    <div className="bench-section-foot">
                      <span>+{clips.length - 5} more clipped</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="bench-empty-block">
                <p className="bench-empty">No clips in the vault yet.</p>
                <p className="bench-empty-hint">
                  Add links from the admin bench editor to fill this shelf.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="bench-close-prompt">
          <button type="button" onClick={onClose}>
            ← roll the wagon back
          </button>
        </div>
      </div>
    </div>
  );
}
