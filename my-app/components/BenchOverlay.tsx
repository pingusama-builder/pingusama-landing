"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import type { Book, ResolvedShelf, ShelfError, VaultData } from "@/lib/books";

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

    const container = containerRef.current;
    const focusable = Array.from(
      container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ) as HTMLElement[];

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, containerRef]);
}

function Cover({ book, className }: { book: Book; className?: string }) {
  return (
    <a
      href={book.infoLink ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className={`bench-cover ${className ?? ""}`}
      title={book.title}
    >
      {book.thumbnail ? (
        <Image
          src={book.thumbnail}
          alt={book.title}
          width={56}
          height={84}
          unoptimized
        />
      ) : (
        <span className="bench-cover-placeholder">{book.title.slice(0, 2)}</span>
      )}
    </a>
  );
}

function ClipRow({ clip }: { clip: Clip }) {
  return (
    <a
      href={clip.url}
      target="_blank"
      rel="noopener noreferrer"
      className="bench-clip"
    >
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
    </a>
  );
}

function ErrorList({ errors }: { errors: ShelfError[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="bench-errors">
      <strong>Some books could not be loaded:</strong>
      <ul className="bench-error-list">
        {errors.map((e) => (
          <li key={e.isbn13}>
            {e.isbn13}
            {e.note && <span className="bench-error-note"> — {e.note}</span>}
          </li>
        ))}
      </ul>
    </div>
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

  const openCount = shelf.currentlyReading.length;
  const waitingCount = shelf.tbr.length;
  const hasBooks = openCount > 0 || waitingCount > 0;
  const hasErrors = shelf.errors.length > 0;

  return (
    <div
      ref={panelRef}
      className={`bench-overlay ${isOpen ? "open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bench-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bench-card">
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

        <div className="bench-grid">
          <div className="bench-section">
            <div className="bench-section-head">
              <h4 id="bench-shelf-title">On the bench</h4>
              <span className="bench-count">
                {openCount} open · {waitingCount} waiting
              </span>
            </div>

            {hasBooks ? (
              <>
                <div
                  className="bench-cover-row"
                  aria-labelledby="bench-shelf-title"
                >
                  {shelf.currentlyReading.map((book, i) => (
                    <Cover
                      key={book.googleBooksId}
                      book={book}
                      className={
                        i === 0 ? "tilt-l" : i === 2 ? "tilt-r" : "lift"
                      }
                    />
                  ))}
                </div>
                <div className="bench-shelf-divider" />
                <div className="bench-section-foot">
                  <span>
                    open:{" "}
                    <span className="bench-tag">
                      {shelf.currentlyReading.map((b) => b.title).join(" · ") ||
                        "—"}
                    </span>
                  </span>
                  <span>+{waitingCount} waiting</span>
                </div>
                {hasErrors && <ErrorList errors={shelf.errors} />}
              </>
            ) : (
              <div className="bench-empty-block">
                <p className="bench-empty">The bench is empty right now.</p>
                {hasErrors && <ErrorList errors={shelf.errors} />}
              </div>
            )}
          </div>

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
                  {clips.slice(0, 5).map((clip) => (
                    <ClipRow key={clip.url} clip={clip} />
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
