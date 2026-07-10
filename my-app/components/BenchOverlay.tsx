"use client";

import { useEffect, useRef, useState } from "react";
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
      {book.coverUrl ? (
        <Image
          src={book.coverUrl}
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

interface BookNoteChipProps {
  book: Book & { note: string };
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function BookNoteChip({
  book,
  isSelected,
  onSelect,
  onClose,
}: BookNoteChipProps) {
  const id = `note-${book.googleBooksId}`;
  return (
    <>
      <button
        type="button"
        className={`bench-note-chip ${isSelected ? "selected" : ""}`}
        onClick={onSelect}
        aria-expanded={isSelected}
        aria-controls={id}
      >
        {book.title}
      </button>
      {isSelected && (
        <div id={id} className="bench-note-panel-row">
          <div className="bench-note-panel">
            <div className="bench-note-head">
              <strong>{book.title}</strong>
              <button
                type="button"
                onClick={onClose}
                className="bench-note-close"
                aria-label="Close note"
              >
                ×
              </button>
            </div>
            {book.note ? (
              <p className="bench-note-body">{book.note}</p>
            ) : (
              <p className="bench-note-empty">
                No note yet. Add one in the admin bench editor.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

interface BookNoteGroupProps {
  title: string;
  count: number;
  books: (Book & { note: string })[];
  selectedBookId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function BookNoteGroup({
  title,
  count,
  books,
  selectedBookId,
  onSelect,
  onClose,
}: BookNoteGroupProps) {
  if (books.length === 0) return null;
  return (
    <div className="bench-note-group-block">
      <h5 className="bench-note-group-title">
        {title} <span className="bench-count">· {count}</span>
      </h5>
      <div className="bench-note-chips">
        {books.map((book) => (
          <BookNoteChip
            key={book.googleBooksId}
            book={book}
            isSelected={selectedBookId === book.googleBooksId}
            onSelect={() => onSelect(book.googleBooksId)}
            onClose={onClose}
          />
        ))}
      </div>
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
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

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
                {(openCount > 0 || waitingCount > 0) && (
                  <div
                    className="bench-cover-row"
                    aria-labelledby="bench-shelf-title"
                  >
                    {[...shelf.currentlyReading, ...shelf.tbr].map((book, i, arr) => {
                      let className = "lift";
                      const total = arr.length;
                      if (total > 1) {
                        if (i === 0) className = "tilt-l";
                        else if (i === total - 1) className = "tilt-r";
                      }
                      return (
                        <Cover
                          key={book.googleBooksId}
                          book={book}
                          className={className}
                        />
                      );
                    })}
                  </div>
                )}
                <div className="bench-shelf-divider" />
                <div className="bench-shelf-notes">
                  <BookNoteGroup
                    title="Currently reading"
                    count={openCount}
                    books={shelf.currentlyReading}
                    selectedBookId={selectedBookId}
                    onSelect={setSelectedBookId}
                    onClose={() => setSelectedBookId(null)}
                  />
                  <BookNoteGroup
                    title="Waiting"
                    count={waitingCount}
                    books={shelf.tbr}
                    selectedBookId={selectedBookId}
                    onSelect={setSelectedBookId}
                    onClose={() => setSelectedBookId(null)}
                  />
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
