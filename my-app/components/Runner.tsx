"use client";

import { useState } from "react";

export default function Runner({ frames }: { frames: string[] }) {
  const [paused, setPaused] = useState(false);

  return (
    <div className="runner-wrap" aria-hidden="true">
      <div
        className={`runner ${paused ? "paused" : ""}`}
        onClick={() => setPaused((p) => !p)}
      >
        {frames.map((src, i) => (
          // These are inline base64 frames from the sprite sheet; Next Image cannot optimize data URIs.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            className={`f${i}`}
            src={`data:image/png;base64,${src}`}
            alt=""
          />
        ))}
      </div>
    </div>
  );
}
