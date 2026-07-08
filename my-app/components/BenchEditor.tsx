"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import type { ShelfData, VaultData, Book } from "@/lib/books";
import { isValidIsbn13, normalizeIsbn13 } from "@/lib/isbn";

interface BenchEditorProps {
  initialShelf: ShelfData;
  initialVault: VaultData;
  saveShelf: (
    shelf: ShelfData
  ) => Promise<{ success: true } | { success: false; error: string }>;
  saveVault: (
    vault: VaultData
  ) => Promise<{ success: true } | { success: false; error: string }>;
  refreshCache: () => Promise<
    { success: true; count: number } | { success: false; error: string }
  >;
  previewBook: (
    isbn13: string
  ) => Promise<{ success: true; book: Book } | { success: false; error: string }>;
}

type SectionKey = "currentlyReading" | "tbr";

const EMPTY_BOOK = { isbn13: "", note: "" };
const EMPTY_CLIP = { title: "", url: "", source: "", date: "", note: "" };

type PreviewState =
  | { status: "idle"; book?: undefined; error?: undefined }
  | { status: "loading"; book?: undefined; error?: undefined }
  | { status: "ok"; book: Book; error?: undefined }
  | { status: "error"; error: string; book?: undefined };

function inputClass(valid?: boolean, touched?: boolean) {
  const base =
    "px-3 py-2 rounded-[var(--radius)] border bg-[var(--bg-card)] text-[var(--walnut)] placeholder:text-[var(--walnut-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]";
  if (!touched || valid === undefined) return `${base} border-[var(--line)]`;
  return valid
    ? `${base} border-[var(--sage)] focus:ring-[var(--sage)]`
    : `${base} border-[var(--terracotta)]`;
}

function ValidityHint({ isbn, touched }: { isbn: string; touched: boolean }) {
  if (!touched || isbn.trim() === "") return null;
  const valid = isValidIsbn13(isbn);
  return (
    <span
      className="text-xs mt-1"
      style={{ color: valid ? "var(--sage-deep)" : "var(--terracotta-d)" }}
    >
      {valid ? "ISBN-13 looks valid" : "ISBN-13 should be 13 digits with a valid check digit"}
    </span>
  );
}

export default function BenchEditor({
  initialShelf,
  initialVault,
  saveShelf,
  saveVault,
  refreshCache,
  previewBook,
}: BenchEditorProps) {
  const [tab, setTab] = useState<"shelf" | "vault">("shelf");
  const [shelf, setShelf] = useState<ShelfData>(initialShelf);
  const [vault, setVault] = useState<VaultData>(initialVault);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  function previewKey(section: SectionKey, index: number) {
    return `${section}-${index}`;
  }

  function showMessage(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(""), 3000);
  }

  function updateBook(
    section: SectionKey,
    index: number,
    field: "isbn13" | "note",
    value: string
  ) {
    setShelf((prev) => {
      const next = { ...prev, [section]: [...prev[section]] };
      next[section][index] = { ...next[section][index], [field]: value };
      return next;
    });
  }

  function addBook(section: SectionKey) {
    setShelf((prev) => ({
      ...prev,
      [section]: [...prev[section], { ...EMPTY_BOOK }],
    }));
  }

  function removeBook(section: SectionKey, index: number) {
    setShelf((prev) => ({
      ...prev,
      [section]: prev[section].filter((_, i) => i !== index),
    }));
    setPreviews((prev) => {
      const next = { ...prev };
      delete next[previewKey(section, index)];
      return next;
    });
  }

  function moveBook(section: SectionKey, index: number, direction: -1 | 1) {
    setShelf((prev) => {
      const items = [...prev[section]];
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= items.length) return prev;
      [items[index], items[newIndex]] = [items[newIndex], items[index]];
      return { ...prev, [section]: items };
    });
    setPreviews((prev) => {
      const a = previewKey(section, index);
      const b = previewKey(section, index + direction);
      const next = { ...prev };
      const tmp = next[a];
      next[a] = next[b];
      next[b] = tmp;
      return next;
    });
  }

  function updateClip(
    index: number,
    field: keyof typeof EMPTY_CLIP,
    value: string
  ) {
    setVault((prev) => {
      const next = { ...prev, clips: [...prev.clips] };
      next.clips[index] = { ...next.clips[index], [field]: value };
      return next;
    });
  }

  function addClip() {
    setVault((prev) => ({
      ...prev,
      clips: [...prev.clips, { ...EMPTY_CLIP }],
    }));
  }

  function removeClip(index: number) {
    setVault((prev) => ({
      ...prev,
      clips: prev.clips.filter((_, i) => i !== index),
    }));
  }

  function moveClip(index: number, direction: -1 | 1) {
    setVault((prev) => {
      const items = [...prev.clips];
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= items.length) return prev;
      [items[index], items[newIndex]] = [items[newIndex], items[index]];
      return { ...prev, clips: items };
    });
  }

  function handleSaveShelf() {
    startTransition(async () => {
      setError("");
      const result = await saveShelf(shelf);
      if (!result.success) {
        setError(result.error);
        return;
      }
      showMessage("Shelf saved.");
    });
  }

  function handleSaveVault() {
    startTransition(async () => {
      setError("");
      const result = await saveVault(vault);
      if (!result.success) {
        setError(result.error);
        return;
      }
      showMessage("Vault saved.");
    });
  }

  function handleRefreshCache() {
    startTransition(async () => {
      setError("");
      const result = await refreshCache();
      if (!result.success) {
        setError(result.error);
        return;
      }
      showMessage(`Cache refreshed with ${result.count} books.`);
    });
  }

  function handlePreview(section: SectionKey, index: number) {
    const isbn = normalizeIsbn13(shelf[section][index].isbn13);
    const key = previewKey(section, index);
    setTouched((prev) => ({ ...prev, [key]: true }));
    if (!isValidIsbn13(isbn)) {
      setPreviews((prev) => ({
        ...prev,
        [key]: { status: "error", error: "Enter a valid ISBN-13 first" },
      }));
      return;
    }
    setPreviews((prev) => ({ ...prev, [key]: { status: "loading" } }));
    startTransition(async () => {
      const result = await previewBook(isbn);
      if (!result.success) {
        setPreviews((prev) => ({
          ...prev,
          [key]: { status: "error", error: result.error },
        }));
        return;
      }
      setPreviews((prev) => ({
        ...prev,
        [key]: { status: "ok", book: result.book },
      }));
    });
  }

  function BookPreview({ state }: { state: PreviewState }) {
    if (state.status === "idle") return null;
    if (state.status === "loading") {
      return (
        <div className="flex items-center gap-2 mt-2 text-sm text-[var(--walnut-soft)]">
          <span className="inline-block w-4 h-4 border-2 border-[var(--line)] border-t-[var(--terracotta)] rounded-full animate-spin" />
          Fetching metadata…
        </div>
      );
    }
    if (state.status === "error") {
      return (
        <p className="text-sm mt-2" style={{ color: "var(--terracotta-d)" }}>
          {state.error}
        </p>
      );
    }
    const book = state.book;
    return (
      <div className="flex items-start gap-3 mt-3 p-3 rounded-[var(--radius)] bg-[var(--bg-card)] border border-[var(--line)]">
        {book.thumbnail ? (
          <Image
            src={book.thumbnail}
            alt={book.title}
            width={48}
            height={72}
            className="rounded shadow-sm"
            unoptimized
          />
        ) : (
          <div className="w-[48px] h-[72px] rounded bg-[var(--bg-card-hi)] border border-dashed border-[var(--line)] flex items-center justify-center text-[10px] text-[var(--walnut-soft)] uppercase tracking-wider">
            no cover
          </div>
        )}
        <div className="min-w-0">
          <p className="font-semibold text-[var(--walnut)] truncate">
            {book.title}
          </p>
          {book.subtitle && (
            <p className="text-sm text-[var(--walnut-soft)] truncate">
              {book.subtitle}
            </p>
          )}
          <p className="text-sm text-[var(--walnut-soft)]">
            {book.authors.join(", ") || "Unknown author"}
          </p>
          {book.publishedDate && (
            <p className="text-xs text-[var(--dusk)] mt-1">
              {book.publishedDate}
              {book.publisher ? ` · ${book.publisher}` : ""}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => setTab("shelf")}
          className={`pill cursor-pointer ${tab === "shelf" ? "live" : ""}`}
        >
          Shelf
        </button>
        <button
          type="button"
          onClick={() => setTab("vault")}
          className={`pill cursor-pointer ${tab === "vault" ? "live" : ""}`}
        >
          Vault
        </button>
        <button
          type="button"
          onClick={handleRefreshCache}
          disabled={isPending}
          className="pill cursor-pointer ml-auto"
        >
          {isPending ? "Refreshing…" : "Refresh book cache"}
        </button>
      </div>

      {error && (
        <div className="detail mb-4" style={{ borderColor: "var(--terracotta)" }}>
          <p className="detail-desc" style={{ color: "var(--terracotta-d)" }}>
            {error}
          </p>
        </div>
      )}

      {message && (
        <div className="detail mb-4" style={{ borderColor: "var(--sage)" }}>
          <p className="detail-desc" style={{ color: "var(--sage-deep)" }}>
            {message}
          </p>
        </div>
      )}

      {tab === "shelf" ? (
        <div className="flex flex-col gap-6">
          {(["currentlyReading", "tbr"] as SectionKey[]).map((section) => (
            <section key={section} className="detail">
              <h3 className="detail-title" style={{ fontSize: "22px" }}>
                {section === "currentlyReading" ? "Currently reading" : "To be read"}
              </h3>

              {shelf[section].length === 0 && (
                <p className="detail-desc">No books in this section yet.</p>
              )}

              <div className="flex flex-col gap-4 mt-4">
                {shelf[section].map((book, i) => {
                  const key = previewKey(section, i);
                  const isTouched = touched[key];
                  const isValid = isValidIsbn13(book.isbn13);
                  return (
                    <div
                      key={key}
                      className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-start p-3 rounded-[var(--radius)] bg-[var(--bg-card-hi)] border border-[var(--line)]"
                    >
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--walnut-soft)]">
                          ISBN-13
                        </label>
                        <input
                          type="text"
                          value={book.isbn13}
                          placeholder="9780307473394"
                          onChange={(e) =>
                            updateBook(section, i, "isbn13", e.target.value)
                          }
                          onBlur={() =>
                            setTouched((prev) => ({ ...prev, [key]: true }))
                          }
                          className={inputClass(
                            book.isbn13.trim() === "" ? undefined : isValid,
                            isTouched
                          )}
                        />
                        <ValidityHint isbn={book.isbn13} touched={!!isTouched} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--walnut-soft)]">
                          Note
                        </label>
                        <input
                          type="text"
                          value={book.note}
                          placeholder="Why this book is on the bench"
                          onChange={(e) =>
                            updateBook(section, i, "note", e.target.value)
                          }
                          className={inputClass()}
                        />
                      </div>
                      <div className="flex items-center gap-1 md:pt-5">
                        <button
                          type="button"
                          onClick={() => moveBook(section, i, -1)}
                          disabled={i === 0}
                          className="px-2 py-1 text-sm rounded hover:bg-[var(--line)] disabled:opacity-30"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveBook(section, i, 1)}
                          disabled={i === shelf[section].length - 1}
                          className="px-2 py-1 text-sm rounded hover:bg-[var(--line)] disabled:opacity-30"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeBook(section, i)}
                          className="px-2 py-1 text-sm rounded text-[var(--terracotta-d)] hover:bg-[var(--bg-card)]"
                        >
                          remove
                        </button>
                      </div>

                      <div className="md:col-span-3">
                        <button
                          type="button"
                          onClick={() => handlePreview(section, i)}
                          disabled={isPending}
                          className="pill cursor-pointer"
                        >
                          {isPending && previews[key]?.status === "loading"
                            ? "Previewing…"
                            : "Preview book"}
                        </button>
                        <BookPreview state={previews[key] ?? { status: "idle" }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => addBook(section)}
                className="pill cursor-pointer mt-4"
              >
                + Add book
              </button>
            </section>
          ))}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveShelf}
              disabled={isPending}
              className="pill live cursor-pointer"
            >
              {isPending ? "Saving…" : "Save shelf"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {vault.clips.map((clip, i) => (
            <div
              key={`clip-${i}`}
              className="detail"
              style={{ padding: "18px 20px" }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[var(--walnut-soft)]">
                    Title
                  </label>
                  <input
                    type="text"
                    value={clip.title}
                    onChange={(e) => updateClip(i, "title", e.target.value)}
                    className={inputClass()}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[var(--walnut-soft)]">
                    URL
                  </label>
                  <input
                    type="url"
                    value={clip.url}
                    onChange={(e) => updateClip(i, "url", e.target.value)}
                    className={inputClass()}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[var(--walnut-soft)]">
                    Source
                  </label>
                  <input
                    type="text"
                    value={clip.source}
                    onChange={(e) => updateClip(i, "source", e.target.value)}
                    className={inputClass()}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[var(--walnut-soft)]">
                    Date
                  </label>
                  <input
                    type="text"
                    value={clip.date}
                    onChange={(e) => updateClip(i, "date", e.target.value)}
                    className={inputClass()}
                  />
                </div>
                <div className="flex flex-col gap-1 md:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[var(--walnut-soft)]">
                    Note
                  </label>
                  <input
                    type="text"
                    value={clip.note}
                    onChange={(e) => updateClip(i, "note", e.target.value)}
                    className={inputClass()}
                  />
                </div>
              </div>

              <div className="flex items-center gap-1 mt-3">
                <button
                  type="button"
                  onClick={() => moveClip(i, -1)}
                  disabled={i === 0}
                  className="px-2 py-1 text-sm rounded hover:bg-[var(--line)] disabled:opacity-30"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveClip(i, 1)}
                  disabled={i === vault.clips.length - 1}
                  className="px-2 py-1 text-sm rounded hover:bg-[var(--line)] disabled:opacity-30"
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeClip(i)}
                  className="px-2 py-1 text-sm rounded text-[var(--terracotta-d)] hover:bg-[var(--bg-card)]"
                >
                  remove
                </button>
              </div>
            </div>
          ))}

          <button type="button" onClick={addClip} className="pill cursor-pointer">
            + Add clip
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveVault}
              disabled={isPending}
              className="pill live cursor-pointer"
            >
              {isPending ? "Saving…" : "Save vault"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
