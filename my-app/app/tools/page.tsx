import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { TOOLS, getActiveTools, type Tool } from "@/lib/tools";

export const metadata = {
  title: "All contraptions · Pingusama's Tinkering",
  description: "A workshop inventory of small makings built by Pingusama.",
};

function ToolRow({ tool }: { tool: Tool }) {
  return (
    <li className="tool-row">
      <div className="tool-row-icon" aria-hidden="true">
        <svg
          viewBox="0 0 32 32"
          fill="none"
          stroke="#C97B5C"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx={16} cy={16} r={11} fill="#FBF4DF" />
          <circle cx={16} cy={16} r={4} fill="#C97B5C" />
        </svg>
      </div>
      <div className="tool-row-body">
        <span className="tool-row-eyebrow">{tool.eyebrow}</span>
        <h3 className="tool-row-title">{tool.title}</h3>
        <p className="tool-row-desc">{tool.desc}</p>
        <div className="tool-row-foot">
          <span className={`tool-row-status ${tool.status}`}>{tool.statusLabel}</span>
          <a
            href={tool.href}
            target="_blank"
            rel="noopener noreferrer"
            className="tool-row-link"
          >
            open {tool.title} →
          </a>
        </div>
      </div>
    </li>
  );
}

function ToolGroup({ title, tools }: { title: string; tools: Tool[] }) {
  if (tools.length === 0) return null;
  return (
    <section className="tool-group">
      <h2 className="tool-group-title">{title}</h2>
      <ul className="tool-list">
        {tools.map((tool) => (
          <ToolRow key={tool.key} tool={tool} />
        ))}
      </ul>
    </section>
  );
}

export default function ToolsPage() {
  const active = getActiveTools();
  const compass = active.filter((t) => t.placement === "compass");
  const workbench = active.filter((t) => t.placement === "workbench");
  const catalogue = active.filter(
    (t) => t.placement === "catalogue" || t.placement === "workbench"
  );
  const archive = Object.values(TOOLS).filter((t) => t.placement === "archive");

  // Deduplicate: workbench also appears in catalogue; only show it once.
  const other = catalogue.filter((t) => t.placement !== "workbench");

  return (
    <>
      <Header />
      <main className="tools-page">
        <div className="wrap">
          <p className="eyebrow">the workshop inventory</p>
          <h1>All contraptions</h1>
          <p className="tools-lede">
            Every making in the workshop, sorted by where it currently lives. The
            compass holds the four enduring tools; the workbench shows what is
            newest or most in need of a second look.
          </p>

          <ToolGroup title="On the compass" tools={compass} />
          {workbench.length > 0 && (
            <ToolGroup title="On the workbench" tools={workbench} />
          )}
          <ToolGroup title="Other contraptions" tools={other} />
          {archive.length > 0 && (
            <ToolGroup title="Resting / archived" tools={archive} />
          )}

          <div className="tools-back">
            <Link href="/">← Back to the workshop compass</Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
