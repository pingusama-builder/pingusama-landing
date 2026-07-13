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
  const wasLocked = useRef(locked);

  useEffect(() => {
    if (currentKey === displayKey) return;
    const panel = detailRef.current;
    panel?.classList.add("fading");
    const id = setTimeout(() => {
      setDisplayKey(currentKey);
      panel?.classList.remove("fading");
    }, 160);
    return () => {
      clearTimeout(id);
      panel?.classList.remove("fading");
    };
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
      className={`detail ${displayKey ? "" : "idle"}`}
    >
      <div className="detail-content">
        <div className="detail-head">
          <span className="detail-eyebrow">
            {t ? t.eyebrow : "the workshop"}
          </span>
          {t && (
            <span className={`pill ${t.status}`}>{t.statusLabel}</span>
          )}
        </div>
        <h2 className="detail-title">
          {t ? t.title : "Touch a point to wake it."}
        </h2>
        <p className="detail-nature">
          {t
            ? t.nature
            : "Each making holds a small piece of work I used to do by hand."}
        </p>
        <p className="detail-desc">
          {t
            ? t.desc
            : "Tap or hover any of the four points on the wheel above. The panel will tell you what the making does, whether it's out in the world yet, and where to find it."}
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
