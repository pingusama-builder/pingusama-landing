"use client";

import { useEffect, useRef, useState } from "react";
import { TOOLS, type ToolKey } from "@/lib/tools";

export default function DetailPanel({
  currentKey,
  locked,
}: {
  currentKey: ToolKey | null;
  locked: boolean;
}) {
  const detailRef = useRef<HTMLDivElement>(null);
  const [displayKey, setDisplayKey] = useState<ToolKey | null>(null);
  const [fading, setFading] = useState(false);
  const wasLocked = useRef(locked);

  useEffect(() => {
    if (currentKey === displayKey) return;
    setFading(true);
    const id = setTimeout(() => {
      setDisplayKey(currentKey);
      setFading(false);
    }, 160);
    return () => clearTimeout(id);
  }, [currentKey, displayKey]);

  useEffect(() => {
    if (locked && !wasLocked.current && detailRef.current) {
      detailRef.current.focus();
      detailRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    wasLocked.current = locked;
  }, [locked]);

  const t = displayKey ? TOOLS[displayKey] : null;

  return (
    <div
      id="detail"
      ref={detailRef}
      tabIndex={-1}
      className={`detail ${displayKey ? "" : "idle"} ${fading ? "fading" : ""}`}
    >
      <div className="detail-content">
        <div className="detail-head">
          <span className="detail-eyebrow">
            {t ? t.eyebrow : "the workshop"}
          </span>
          {t && (
            <span className={`pill ${t.statusKind}`}>{t.status}</span>
          )}
        </div>
        <h2 className="detail-title">
          {t ? t.title : "Pick a point to see its true nature."}
        </h2>
        <p className="detail-nature">
          {t
            ? t.nature
            : "Each tool holds a small piece of work I used to do by hand."}
        </p>
        <p className="detail-desc">
          {t
            ? t.desc
            : "Tap or hover any of the four points on the wheel above. The panel will tell you what the tool does, whether it's live yet, and where to find it."}
        </p>
        {t && (
          <div className="detail-foot">
            <span />
            <a
              className="open-link"
              href={t.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              open {t.title} →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
