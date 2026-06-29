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
