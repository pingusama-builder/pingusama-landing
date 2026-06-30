import Link from "next/link"

type PaginationProps = {
  currentPage: number
  totalPages: number
  basePath: string
}

export default function Pagination({
  currentPage,
  totalPages,
  basePath,
}: PaginationProps) {
  if (totalPages <= 1) {
    return null
  }

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1)

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-center gap-2 mt-6 flex-wrap"
    >
      {currentPage > 1 ? (
        <Link href={`${basePath}?page=${currentPage - 1}`} className="pill">
          ← Prev
        </Link>
      ) : (
        <span className="pill opacity-50 cursor-not-allowed">← Prev</span>
      )}

      <div className="flex items-center gap-1 flex-wrap">
        {pages.map((page) =>
          page === currentPage ? (
            <span key={page} className="pill live">
              {page}
            </span>
          ) : (
            <Link
              key={page}
              href={`${basePath}?page=${page}`}
              className="pill"
            >
              {page}
            </Link>
          ),
        )}
      </div>

      {currentPage < totalPages ? (
        <Link href={`${basePath}?page=${currentPage + 1}`} className="pill">
          Next →
        </Link>
      ) : (
        <span className="pill opacity-50 cursor-not-allowed">Next →</span>
      )}
    </nav>
  )
}
