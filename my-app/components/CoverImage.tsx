"use client"

import { useState } from "react"

function CoverPlaceholder({ label }: { label: string }) {
  return (
    <div
      aria-label={`No cover image for ${label}`}
      className="aspect-video w-full rounded-[var(--radius)] border border-dashed border-[var(--line)] bg-[var(--bg-card-hi)] flex items-center justify-center px-4 text-center"
    >
      <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--walnut-soft)]">
        Image coming soon
      </span>
    </div>
  )
}

export default function CoverImage({
  src,
  label,
}: {
  src: string | null | undefined
  label: string
}) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return <CoverPlaceholder label={label} />
  }

  return (
    <div className="aspect-video w-full overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--bg-card-hi)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Cover image for ${label}`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  )
}
