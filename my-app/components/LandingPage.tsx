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
import { TOOLS, type ToolKey } from "@/lib/tools";
import { Post } from "@/lib/db/posts";
import type { ResolvedShelf, VaultData } from "@/lib/books";

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
    if (becomingLocked && TOOLS[key].statusKind === "local") {
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
            <Runner frames={frames} />
          </div>

          <DetailPanel currentKey={lockedKey || activeKey} locked={!!lockedKey} />
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
