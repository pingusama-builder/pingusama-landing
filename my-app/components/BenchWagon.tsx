"use client";

import Image from "next/image";
import type { Book } from "@/lib/books";

interface BenchWagonProps {
  books: Book[];
  isOpen: boolean;
  onOpen: () => void;
}

export default function BenchWagon({ books, isOpen, onOpen }: BenchWagonProps) {
  const covers = books.slice(0, 3);

  return (
    <button
      type="button"
      className="bench-wagon"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-label="Open the bench: shelf and vault"
    >
      <span className="wagon-body">
        <span className="wagon-covers" aria-hidden="true">
          {covers.map((book, i) => (
            <span key={book.googleBooksId ?? i} className={`wagon-cover tilt-${i}`}>
              {(book.coverUrl ?? book.thumbnail) ? (
                <Image
                  src={(book.coverUrl ?? book.thumbnail)!}
                  alt={book.title}
                  width={42}
                  height={96}
                  unoptimized
                />
              ) : (
                <span className="cover-placeholder" />
              )}
            </span>
          ))}
          {covers.length === 0 && (
            <>
              <span className="wagon-cover tilt-0"><span className="cover-placeholder" /></span>
              <span className="wagon-cover tilt-1"><span className="cover-placeholder" /></span>
              <span className="wagon-cover tilt-2"><span className="cover-placeholder" /></span>
            </>
          )}
        </span>
        <span className="wagon-label">
          the bench
          <span className="wagon-sublabel">shelf · vault</span>
        </span>
      </span>
      <span className="wagon-wheels" aria-hidden="true">
        <span className="wagon-wheel" />
        <span className="wagon-wheel" />
      </span>
    </button>
  );
}
