import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { ReactNode } from "react"

// Safe markdown renderer for UNTRUSTED model output (chat + blog companion
// transcripts). Renders to React elements only — no raw HTML, no
// dangerouslySetInnerHTML, no `rehype-raw` — so prompt-injected markup in the
// model's text can never reach the DOM as executable HTML. This preserves the
// shipped security property that model output has no HTML-injection surface.
//
// Links are disabled: the model's text is untrusted, so `[label](url)` renders
// as the label with no anchor (no clickable link, no href). This keeps the
// transcript non-navigating and avoids javascript:/data: URL vectors entirely.
//
// GFM is enabled (lists, strikethrough, tables) so the model's FINDINGS bullets
// and structured output render readably; emphasis (**bold**, *italic*, `code`)
// is the primary reason this component exists — previously those markers showed
// literally as `**bold**` in a plain-text pre-wrap container.

export function MarkdownText({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div className={className ? `md-text ${className}` : "md-text"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Disable links: render the label as plain text, drop the href.
          a: ({ children }) => <>{children}</> as ReactNode,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}