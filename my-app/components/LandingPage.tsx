"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "./Header";
import Footer from "./Footer";
import Wheel from "./Wheel";
import Runner from "./Runner";
import BenchWagon from "./BenchWagon";
import BenchOverlay from "./BenchOverlay";
import DetailPanel from "./DetailPanel";
import PostCard from "./PostCard";
import { TOOLS, type ToolKey, getWorkbenchTool } from "@/lib/tools";
import { Post } from "@/lib/db/posts";
import type { ResolvedShelf, VaultData } from "@/lib/books";
import WorkbenchFeature from "./WorkbenchFeature";

export default function LandingPage({
  frames,
  posts,
  shelf,
  vault,
}: {
  frames: string[];
  posts: Post[];
  shelf: ResolvedShelf;
  vault: VaultData;
}) {
  const workbenchTool = getWorkbenchTool();
  const [activeKey, setActiveKey] = useState<ToolKey | null>(null);
  const [lockedKey, setLockedKey] = useState<ToolKey | null>(null);
  const [benchOpen, setBenchOpen] = useState(false);

  const handleHover = (key: ToolKey) => {
    if (lockedKey && lockedKey !== key) return;
    setActiveKey(key);
  };

  const handleFocus = (key: ToolKey) => {
    if (lockedKey && lockedKey !== key) return;
    setActiveKey(key);
  };

  const handleLeave = () => {
    if (lockedKey) return;
    if (activeKey) setActiveKey(null);
  };

  const handleClick = (key: ToolKey) => {
    setActiveKey(key);
    const becomingLocked = lockedKey !== key;
    setLockedKey((prev) => (prev === key ? null : key));
    if (becomingLocked && TOOLS[key].status === "resting") {
      window.open(TOOLS[key].href, "_blank", "noopener");
    }
  };

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest("#wheel-wrap") || target.closest("#detail")) return;
      if (lockedKey) {
        setLockedKey(null);
        setActiveKey(null);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [lockedKey]);

  return (
    <>
      <Header />
      <main>
        <section id="wheel" className="hero wrap">
          <div className="eyebrow">a quiet workshop · est. 2026</div>
          <h1>
            The work of a tinkerer:{" "}
            <em>small, stubborn, useful most of the time.</em>
          </h1>
          <p className="lede">
            A handful of small contraptions, each one built because I was tired of
            doing something the long way. Touch a point to wake it.
          </p>

          <div className="scene">
            <BenchWagon
              books={shelf.currentlyReading}
              isOpen={benchOpen}
              onOpen={() => setBenchOpen(true)}
            />
            <Wheel
              lockedKey={lockedKey}
              onHover={handleHover}
              onFocus={handleFocus}
              onClick={handleClick}
              onLeave={handleLeave}
            />
            <Link href="/portrait/atlas" className="portrait-tile" aria-label="Enter the portrait">
              <div className="portrait-tile-thumb" aria-hidden="true">
                <svg viewBox="0 0 132 96" preserveAspectRatio="none">
                  <defs>
                    <filter id="pt-paper">
                      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>
                      <feColorMatrix values="0 0 0 0 0.92  0 0 0 0 0.87  0 0 0 0 0.72  0 0 0 0.2 0"/>
                    </filter>
                    <filter id="pt-blur5"><feGaussianBlur stdDeviation="5"/></filter>
                    <filter id="pt-blur7"><feGaussianBlur stdDeviation="7"/></filter>
                    <filter id="pt-blur4"><feGaussianBlur stdDeviation="4"/></filter>
                  </defs>
                  <rect width="132" height="96" fill="#E8DCC0"/>
                  <rect width="132" height="96" filter="url(#pt-paper)" opacity="0.5"/>
                  <g opacity="0.6">
                    <ellipse cx="42" cy="36" rx="36" ry="24" fill="#4A3C2E" filter="url(#pt-blur5)"/>
                    <ellipse cx="96" cy="30" rx="40" ry="20" fill="#5E4D3A" filter="url(#pt-blur7)"/>
                    <ellipse cx="122" cy="52" rx="20" ry="15" fill="#4A3C2E" filter="url(#pt-blur4)"/>
                  </g>
                  <path d="M0 84 Q36 70 66 82 T108 78 T132 88 V96 H0 Z" fill="#2B2118" opacity="0.32"/>
                  <path d="M0 92 Q30 84 60 92 T120 90 T132 96 V96 H0 Z" fill="#4A3C2E" opacity="0.24"/>
                  <g opacity="0.28">
                    <path d="M10 76 Q22 62 32 76 T50 72" stroke="#4A7A6B" strokeWidth="2" fill="none" filter="url(#pt-blur4)"/>
                    <path d="M98 64 Q110 50 122 64 T138 60" stroke="#2F5449" strokeWidth="1.5" fill="none" filter="url(#pt-blur4)"/>
                  </g>
                  <circle cx="106" cy="24" r="6" fill="#B08D3E" opacity="0.85"/>
                  <circle cx="106" cy="24" r="10" stroke="#B08D3E" strokeWidth="1" fill="none" opacity="0.35"/>
                </svg>
              </div>
              <div className="portrait-tile-text">
                <span className="portrait-tile-label">Portrait</span>
                <span className="portrait-tile-sub">現在 · 工坊</span>
              </div>
            </Link>
            <Runner frames={frames} />
          </div>

          <DetailPanel currentKey={lockedKey || activeKey} locked={!!lockedKey} />

          {workbenchTool && (
            <section
              id="workbench"
              className="workbench-band"
              aria-label="Recently on the workbench"
            >
              <p className="workbench-section-eyebrow">Recently on the workbench</p>
              <WorkbenchFeature tool={workbenchTool} />
              <div className="workbench-tools-link">
                <a href="/tools">See all contraptions →</a>
              </div>
            </section>
          )}
        </section>

        <div className="divider" aria-hidden="true">
          <svg
            viewBox="0 0 160 22"
            fill="none"
            stroke="#8B6F47"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 12 C 14 4, 26 20, 40 12 S 66 4, 80 12 S 106 20, 120 12 S 146 4, 158 12" />
            <circle cx={80} cy={12} r={2.2} fill="#C97B5C" stroke="none" />
          </svg>
        </div>

        <section id="notes" className="notes-band wrap" aria-label="Latest notes">
          <div className="notes-head">
            <div>
              <p className="notes-eyebrow">from the workshop</p>
              <h2 className="notes-title">Notes from the workshop</h2>
            </div>
            <Link href="/blog" className="notes-all">
              All notes →
            </Link>
          </div>

          {posts.length === 0 ? (
            <div className="notes-empty">
              <p>No notes yet. Check back as the workshop fills up.</p>
            </div>
          ) : (
            <div className="notes-grid">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </section>

        <section
          id="about"
          className="wrap"
          style={{ textAlign: "center", padding: "4px 0 20px", maxWidth: 620 }}
        >
          <p style={{ margin: "0 0 6px" }}>
            Each making lives on its own subdomain and runs where it can.
          </p>
          <p style={{ margin: 0, color: "var(--walnut-soft)" }}>
            No accounts. No tracking. Made by{" "}
            <span className="sig">Pingusama</span>, with copper and patience.
          </p>
        </section>
      </main>
      <BenchOverlay
        isOpen={benchOpen}
        onClose={() => setBenchOpen(false)}
        shelf={shelf}
        vault={vault}
      />
      <Footer />
    </>
  );
}
