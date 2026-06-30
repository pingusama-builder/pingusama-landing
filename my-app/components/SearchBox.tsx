"use client"

import { useState } from "react"

type SearchBoxProps = {
  initialQuery?: string
}

export default function SearchBox({ initialQuery = "" }: SearchBoxProps) {
  const [query, setQuery] = useState(initialQuery)

  return (
    <form
      action="/blog/search"
      method="GET"
      className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center max-w-xl mx-auto mb-8"
    >
      <label htmlFor="q" className="sr-only">
        Search
      </label>
      <input
        id="q"
        name="q"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search the workshop..."
        required
        className="flex-1 px-4 py-2 rounded-full border border-[var(--line)] bg-[var(--bg-card)] text-[var(--walnut)] placeholder:text-[var(--walnut-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--terracotta)]"
      />
      <button type="submit" className="pill cursor-pointer">
        Search
      </button>
    </form>
  )
}
