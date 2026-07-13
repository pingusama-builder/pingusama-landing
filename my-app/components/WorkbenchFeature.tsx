"use client";

import { Tool } from "@/lib/tools";

export default function WorkbenchFeature({ tool }: { tool: Tool }) {
  return (
    <div className="workbench-feature">
      <div className="workbench-icon" aria-hidden="true">
        <svg
          viewBox="0 0 32 32"
          fill="none"
          stroke="#C97B5C"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx={16} cy={12} r={6} fill="#FBF4DF" />
          <path
            d="M10 18 C10 24 13 28 16 28 C19 28 22 24 22 18"
            fill="#FBF4DF"
            stroke="#A55E42"
          />
          <circle cx={14} cy={11} r={1} fill="#3E2C20" stroke="none" />
          <circle cx={18} cy={11} r={1} fill="#3E2C20" stroke="none" />
          <path
            d="M15 15 C15 15 16 16 17 15"
            stroke="#A55E42"
            strokeWidth={1.2}
            fill="none"
          />
          <path d="M8 6 L11 9 M24 6 L21 9" stroke="#C97B5C" strokeWidth={1.2} />
        </svg>
      </div>
      <div className="workbench-body">
        <div className="workbench-head">
          <span className="workbench-eyebrow">{tool.eyebrow}</span>
          <span className="workbench-badge">newly unpacked</span>
        </div>
        <h2 className="workbench-title">{tool.title}</h2>
        <p className="workbench-nature">{tool.nature}</p>
        <p className="workbench-desc">{tool.desc}</p>
        <div className="workbench-foot">
          <a
            className="workbench-link"
            href={tool.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            open {tool.title} →
          </a>
        </div>
      </div>
    </div>
  );
}
