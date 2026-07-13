"use client";

import { ToolKey, getCompassTools, type CompassDirection } from "@/lib/tools";

interface WheelProps {
  lockedKey: ToolKey | null;
  onHover: (key: ToolKey) => void;
  onFocus: (key: ToolKey) => void;
  onClick: (key: ToolKey) => void;
  onLeave: () => void;
}

interface PointConfig {
  key: ToolKey;
  label: string;
  cx: number;
  cy: number;
  direction: CompassDirection;
  title: string;
}

const COMPASS_POINTS: PointConfig[] = [
  { key: "epub", label: "EPUB", cx: 100, cy: 42, direction: "north", title: "EPUB Converter — open the panel" },
  { key: "vn", label: "VN", cx: 158, cy: 100, direction: "east", title: "VN Finder — open the panel" },
  { key: "sw", label: "SW", cx: 100, cy: 158, direction: "south", title: "Summoners War Parser — open the panel" },
  { key: "words", label: "Words", cx: 42, cy: 100, direction: "west", title: "Name of the Words — open the panel" },
];

const DIRECTION_LABELS: Record<CompassDirection, string> = {
  north: "N",
  east: "E",
  south: "S",
  west: "W",
};

function ToolPoint({
  cfg,
  locked,
  onHover,
  onFocus,
  onClick,
}: {
  cfg: PointConfig;
  locked: boolean;
  onHover: (key: ToolKey) => void;
  onFocus: (key: ToolKey) => void;
  onClick: (key: ToolKey) => void;
}) {
  const { key, label, cx, cy, title } = cfg;
  return (
    <a
      className={`point ${locked ? "locked" : ""}`}
      href="#detail"
      data-tool={key}
      onMouseEnter={() => onHover(key)}
      onFocus={() => onFocus(key)}
      onClick={(e) => {
        e.preventDefault();
        onClick(key);
      }}
    >
      <title>{title}</title>
      <circle className="point-tile" cx={cx} cy={cy} r={20} />
      {key === "epub" && (
        <svg
          className="point-icon"
          x={cx - 16}
          y={cy - 16}
          width={32}
          height={32}
          viewBox="0 0 32 32"
          fill="none"
          stroke="#C97B5C"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M5 6 C 5 5, 6 4, 7 4 H 14 C 15 4, 16 5, 16 6 V 27 C 16 26, 15 25, 14 25 H 7 C 6 25, 5 26, 5 27 Z"
            fill="#FBF4DF"
          />
          <path
            d="M27 6 C 27 5, 26 4, 25 4 H 18 C 17 4, 16 5, 16 6 V 27 C 16 26, 17 25, 18 25 H 25 C 26 25, 27 26, 27 27 Z"
            fill="#EFE3CA"
          />
          <path d="M9 9 H 12 M9 13 H 12 M20 9 H 23 M20 13 H 23" />
        </svg>
      )}
      {key === "vn" && (
        <svg
          className="point-icon"
          x={cx - 16}
          y={cy - 16}
          width={32}
          height={32}
          viewBox="0 0 32 32"
          fill="none"
          stroke="#C97B5C"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx={16} cy={16} r={12} fill="#FBF4DF" />
          <path
            d="M16 6 L 18.5 16 L 16 26 L 13.5 16 Z"
            fill="#C97B5C"
            stroke="#A55E42"
          />
          <circle cx={16} cy={16} r={1.6} fill="#3E2C20" />
        </svg>
      )}
      {key === "sw" && (
        <svg
          className="point-icon"
          x={cx - 16}
          y={cy - 16}
          width={32}
          height={32}
          viewBox="0 0 32 32"
          fill="none"
          stroke="#C97B5C"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx={16} cy={16} r={11} fill="#FBF4DF" />
          <circle cx={16} cy={16} r={7} strokeDasharray="2 2" />
          <path
            d="M16 5 L 17.5 14.5 L 27 16 L 17.5 17.5 L 16 27 L 14.5 17.5 L 5 16 L 14.5 14.5 Z"
            fill="#4F6D7A"
            stroke="#3B5563"
          />
        </svg>
      )}
      {key === "words" && (
        <svg
          className="point-icon"
          x={cx - 16}
          y={cy - 16}
          width={32}
          height={32}
          viewBox="0 0 32 32"
          fill="none"
          stroke="#C97B5C"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M16 14 C 10 14, 7 10, 7 5 C 12 5, 16 9, 16 14 Z"
            fill="#8FA876"
            stroke="#6E8A57"
          />
          <path
            d="M16 14 C 22 14, 25 10, 25 5 C 20 5, 16 9, 16 14 Z"
            fill="#8FA876"
            stroke="#6E8A57"
          />
          <path d="M16 27 V 14" />
          <path d="M11 27 H 21" />
        </svg>
      )}
      {key === "words" && (
        <g className="wind-leaves" transform={`translate(${cx} ${cy})`}>
          <path
            className="leaf"
            d="M -2 -2 C -6 -6, -4 -10, 0 -10 C 4 -10, 6 -6, 2 -2 C 0 0, -1 -1, -2 -2 Z"
            fill="#8FA876"
            stroke="#6E8A57"
            strokeWidth={0.6}
          />
          <path
            className="leaf"
            d="M 2 2 C -2 -2, 0 -6, 4 -6 C 8 -6, 10 -2, 6 2 C 4 4, 3 3, 2 2 Z"
            fill="#A3C08A"
            stroke="#6E8A57"
            strokeWidth={0.6}
          />
          <path
            className="leaf"
            d="M -4 4 C -8 0, -6 -4, -2 -4 C 2 -4, 4 0, 0 4 C -2 6, -3 5, -4 4 Z"
            fill="#8FA876"
            stroke="#6E8A57"
            strokeWidth={0.6}
          />
        </g>
      )}
      <text className="point-label" x={cx} y={cy + 34} dy={0}>
        {label}
      </text>
    </a>
  );
}

export default function Wheel({
  lockedKey,
  onHover,
  onFocus,
  onClick,
  onLeave,
}: WheelProps) {
  // Defensive: the compass is intentionally fixed at four points. If the data
  // model drifts, render the four configured positions rather than expanding.
  const points = COMPASS_POINTS;

  return (
    <div className="wheel-wrap" id="wheel-wrap" onMouseLeave={onLeave}>
      <svg
        className="wheel-svg"
        viewBox="0 0 220 240"
        fill="none"
        role="img"
        aria-label="Workshop compass"
      >
        <text className="wheel-title" x={110} y={18}>
          ~ the workshop&apos;s compass ~
        </text>

        <g className="vine">
          <path d="M 22 92 C 12 100, 8 110, 12 122 C 16 132, 26 134, 34 128" />
          <path d="M 198 92 C 208 100, 212 110, 208 122 C 204 132, 194 134, 186 128" />
          <path d="M 28 138 C 18 146, 14 156, 18 168 C 22 178, 32 180, 40 174" />
          <path d="M 192 138 C 202 146, 206 156, 202 168 C 198 178, 188 180, 180 174" />
        </g>

        <g className="vine-leaf">
          <path d="M 14 116 C 8 112, 6 118, 10 122 C 14 126, 18 122, 14 116 Z" />
          <path d="M 26 130 C 32 128, 34 134, 30 138 C 26 142, 22 138, 26 130 Z" />
          <path d="M 206 116 C 212 112, 214 118, 210 122 C 206 126, 202 122, 206 116 Z" />
          <path d="M 194 130 C 188 128, 186 134, 190 138 C 194 142, 198 138, 194 130 Z" />
          <path d="M 20 162 C 14 158, 12 164, 16 168 C 20 172, 24 168, 20 162 Z" />
          <path d="M 32 176 C 38 174, 40 180, 36 184 C 32 188, 28 184, 32 176 Z" />
          <path d="M 200 162 C 206 158, 208 164, 204 168 C 200 172, 196 168, 200 162 Z" />
          <path d="M 188 176 C 182 174, 180 180, 184 184 C 188 188, 192 184, 188 176 Z" />
        </g>

        <g transform="translate(10 30)">
          <circle cx="100" cy="100" r="92" stroke="#8B6F47" strokeWidth={1.4} />
          <circle
            cx="100"
            cy="100"
            r="80"
            stroke="#A88758"
            strokeWidth={0.7}
            strokeDasharray="1.5 3"
          />

          <path
            d="M100 8 V 18 M100 182 V 192 M8 100 H 18 M182 100 H 192"
            stroke="#8B6F47"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
          <path
            d="M138.6 61.4 L 144.1 55.9 M61.4 138.6 L 55.9 144.1 M138.6 138.6 L 144.1 144.1 M61.4 61.4 L 55.9 55.9"
            stroke="#A88758"
            strokeWidth={0.9}
            strokeLinecap="round"
          />

          <g className="motif" transform="translate(156 44)">
            <path
              d="M 0 -6 A 6 6 0 1 0 0 6 A 4 4 0 1 1 0 -6 Z"
              fill="#FAF3E0"
            />
          </g>
          <g transform="translate(178 70)">
            <path
              className="motif-fill"
              d="M 0 0 C -4 -2, -4 -6, 0 -8 C 4 -6, 4 -2, 0 0 Z"
            />
            <path d="M 0 0 V -7" stroke="#6E8A57" strokeWidth={0.6} />
          </g>
          <g className="motif" transform="translate(178 130)">
            <path
              d="M -5 0 C -3 -3, -1 -3, 0 -1 C 1 -3, 3 -3, 5 0 C 3 1, 1 0, 0 1 C -1 0, -3 1, -5 0 Z"
              fill="#8B6F47"
            />
            <circle cx={2.5} cy={-1.5} r={0.5} fill="#FBF4DF" stroke="none" />
          </g>
          <g transform="translate(156 156)">
            <path
              className="motif-fill"
              d="M -5 0 C -5 -4, 5 -4, 5 0 Z"
            />
            <path
              d="M -1 0 V 4 M 1 0 V 4"
              stroke="#8B6F47"
              strokeWidth={0.8}
              strokeLinecap="round"
            />
          </g>
          <g transform="translate(64 156)">
            <path
              className="motif"
              d="M -3 0 V 4 C -3 5, 3 5, 3 0 Z"
              fill="#FBF4DF"
            />
            <path
              d="M -4 0 C -4 -3, 4 -3, 4 0 Z"
              fill="#8B6F47"
              stroke="#8B6F47"
              strokeWidth={0.6}
            />
          </g>
          <g className="motif" transform="translate(42 130)">
            <circle cx={-3} cy={0} r={2.5} />
            <path d="M -0.5 0 H 6 M 4 0 V 2 M 5.5 0 V 1.5" />
          </g>
          <g transform="translate(42 70)">
            <path
              d="M 0 -6 C -2 -3, -2 -1, 0 1 C 2 -1, 2 -3, 0 -6 Z"
              fill="#C97B5C"
              stroke="#A55E42"
              strokeWidth={0.6}
            />
            <path
              d="M -1.5 1 V 5 M 1.5 1 V 5 M -1.5 5 H 1.5"
              stroke="#8B6F47"
              strokeWidth={0.8}
              strokeLinecap="round"
            />
          </g>
          <g transform="translate(64 44)">
            <circle r={3} fill="#D4A85A" stroke="#A88758" strokeWidth={0.6} />
            <g stroke="#A88758" strokeWidth={0.8} strokeLinecap="round">
              <path d="M 0 -5 V -7" />
              <path d="M 0 5 V 7" />
              <path d="M -5 0 H -7" />
              <path d="M 5 0 H 7" />
              <path d="M -3.5 -3.5 L -5 -5" />
              <path d="M 3.5 -3.5 L 5 -5" />
              <path d="M -3.5 3.5 L -5 5" />
              <path d="M 3.5 3.5 L 5 5" />
            </g>
          </g>

          <circle cx="100" cy="8" r={3} fill="#C97B5C" />

          <g stroke="#8B6F47" strokeWidth={1} strokeLinecap="round">
            <line x1="100" y1="100" x2="100" y2="42" />
            <line x1="100" y1="100" x2="158" y2="100" />
            <line x1="100" y1="100" x2="100" y2="158" />
            <line x1="100" y1="100" x2="42" y2="100" />
          </g>

          {points.map((cfg) => (
            <ToolPoint
              key={cfg.key}
              cfg={cfg}
              locked={lockedKey === cfg.key}
              onHover={onHover}
              onFocus={onFocus}
              onClick={onClick}
            />
          ))}

          <g opacity={0.55}>
            <path d="M100 76 L 104 100 L 100 124 L 96 100 Z" fill="#8FA876" />
            <path d="M76 100 L 100 104 L 124 100 L 100 96 Z" fill="#8FA876" />
            <circle cx="100" cy="100" r={3} fill="#4F6D7A" />
            <circle
              cx="100"
              cy="100"
              r={7}
              fill="none"
              stroke="#8B6F47"
              strokeWidth={0.6}
            />
            <path
              d="M97 100 Q 100 96, 103 100"
              stroke="#FBF4DF"
              strokeWidth={0.8}
              fill="none"
              strokeLinecap="round"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}
