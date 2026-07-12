"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { setThreadModelPreferenceAction } from "@/app/admin/chat/actions"
import {
  validateProposal,
  type Proposal,
  type DraftSnapshot,
  type UndoTarget,
  type ApplyResult,
} from "@/lib/blog/proposals"
import { appendAssistantDelta } from "@/lib/chat/stream-updater"
import { MarkdownText } from "@/components/MarkdownText"

type Scope = "title" | "sentence" | "opening" | "section" | "full"

export interface QuickAction {
  label: string
  scope: Scope
  hint: string
}

// Spec §9 quick actions. Each declares a scope → tier (resolved server-side).
export const PROSE_QUICK_ACTIONS: QuickAction[] = [
  { label: "Review this draft", scope: "full", hint: "Full structural review" },
  { label: "Omit needless words", scope: "full", hint: "Tighten prose (SW1)" },
  { label: "Flag passive voice & stale phrases", scope: "full", hint: "O4 / SW2 pass" },
  { label: "Suggest title options", scope: "title", hint: "Title alternatives" },
  { label: "Check the opening", scope: "opening", hint: "Opening paragraph" },
]

export const FICTION_QUICK_ACTIONS: QuickAction[] = [
  { label: "Review this story", scope: "full", hint: "Promise, stakes, movement, POV" },
  { label: "Check the opening promise", scope: "opening", hint: "Tone, intrigue, orientation" },
  { label: "Check scene movement", scope: "section", hint: "Transitions and forward curiosity" },
  { label: "Check POV and distance", scope: "section", hint: "Who perceives this moment?" },
  { label: "Check dialogue and beats", scope: "section", hint: "Speaker, intent, relation" },
  { label: "Offer title directions", scope: "title", hint: "Options with tradeoffs" },
]

function quickActionsFor(reviewMode: ReviewMode): QuickAction[] {
  return reviewMode === "fiction" ? FICTION_QUICK_ACTIONS : PROSE_QUICK_ACTIONS
}

export const SCOPE_LABELS: Record<Scope, string> = {
  title: "title",
  sentence: "sentence",
  opening: "opening",
  section: "section",
  full: "full",
}

export const CRAFT_NOTE_LABELS: Record<string, string> = {
  // Voice (always first-class)
  V1: "Voice", V2: "Voice", V3: "Voice",
  // Prose economy
  O1: "Stale metaphor", O2: "Short words", O3: "Cut words", O4: "Active voice",
  O5: "Everyday words", O6: "Break the rule",
  SW1: "Omit needless words", SW2: "Active voice", SW3: "Positive form", SW4: "Loose sentences",
  Z1: "Simplicity", Z2: "Unity", Z3: "Voice",
  // Fiction lenses
  F1: "Narrative promise", F2: "Desire & stakes", F3: "Scene movement",
  F4: "POV & distance", F5: "Dialogue as action", F6: "Worldbuilding",
}

type ProposalStatus = "pending" | "applicable" | "applied" | "stale" | "rejected"

interface ProposalCard {
  proposal: Proposal
  status: ProposalStatus
  undo?: UndoTarget
}

interface ChatLine {
  role: "user" | "assistant"
  text: string
}

export interface BlogCompanionProps {
  draft: DraftSnapshot
  subjectType: "post" | "draft"
  subjectKey: string
  threadId?: string
  saveInProgress: boolean
  onThreadReady: (threadId: string) => void
  onApply: (proposal: Proposal) => Promise<ApplyResult>
  onUndo: (undoTarget: UndoTarget) => void
  onReveal: (original: string) => void
}

const MODEL_OPTIONS: { value: "auto" | "small" | "medium" | "large"; label: string }[] = [
  { value: "auto", label: "auto" },
  { value: "small", label: "small" },
  { value: "medium", label: "medium" },
  { value: "large", label: "large" },
]

export type ReviewMode = "auto" | "prose" | "fiction" | "line-edit"
const REVIEW_MODE_OPTIONS: { value: ReviewMode; label: string }[] = [
  { value: "auto", label: "auto" },
  { value: "prose", label: "prose" },
  { value: "fiction", label: "fiction" },
  { value: "line-edit", label: "line-edit" },
]

function fieldLabel(field: Proposal["field"]): string {
  switch (field) {
    case "body":
      return "body"
    case "title":
      return "title"
    case "excerpt":
      return "excerpt"
    case "meta_description":
      return "meta description"
  }
}

export default function BlogCompanion(props: BlogCompanionProps) {
  const {
    draft,
    subjectType,
    subjectKey,
    threadId,
    saveInProgress,
    onThreadReady,
    onApply,
    onUndo,
    onReveal,
  } = props
  const [input, setInput] = useState("")
  const [scope, setScope] = useState<Scope>("full")
  const [lines, setLines] = useState<ChatLine[]>([])
  const [cards, setCards] = useState<ProposalCard[]>([])
  const [log, setLog] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const [modelTier, setModelTier] = useState<string>("")
  const [error, setError] = useState<{ message: string; partial: boolean } | null>(null)
  const [liveRegion, setLiveRegion] = useState("")
  const [modelValue, setModelValue] = useState<"auto" | "small" | "medium" | "large">("auto")
  const [reviewMode, setReviewMode] = useState<ReviewMode>("auto")
  const [visible, setVisible] = useState(true)
  // Reasoning stream (advisor phase B8): the model's thinking tokens stream on
  // a separate SSE channel into a collapsible "Thinking…" panel so the long
  // reasoning latency never looks hung. Toggle (default ON) is per-browser
  // persisted; OFF hides the text but a minimal "Working…" pulse still shows.
  const [reasoningText, setReasoningText] = useState("")
  const [reasoningCollapsed, setReasoningCollapsed] = useState(false)
  const [showReasoning, setShowReasoning] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return true
    return localStorage.getItem("companion-show-reasoning") !== "0"
  })
  // Structured fiction review (submit_fiction_review terminal): assessment +
  // finding headers + a NO CHANGE badge, rendered above the proposal cards.
  const [fictionReview, setFictionReview] = useState<{
    assessment: string
    noChange: boolean
    findings: { diagnosis: string; principleId: string; hasEdit: boolean }[]
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const pendingCount = cards.filter(
    (c) => c.status === "applicable" || c.status === "pending"
  ).length

  // Cancel any in-flight stream if the panel unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const send = useCallback(
    async (message: string, chosenScope: Scope) => {
      const text = message.trim()
      if (!text || streaming) return
      setError(null)
      setStreaming(true)
      setLiveRegion("Reviewing…")
      setReasoningText("")
      setReasoningCollapsed(false)
      setFictionReview(null)
      setLines((prev) => [...prev, { role: "user", text }, { role: "assistant", text: "" }])

      const ac = new AbortController()
      abortRef.current?.abort()
      abortRef.current = ac

      try {
        const res = await fetch("/api/blog-companion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            message: text,
            subjectType,
            subjectKey,
            draft,
            scope: chosenScope,
            reviewMode,
          }),
          signal: ac.signal,
        })
        if (!res.body) throw new Error("No response body")
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let sep: number
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, sep)
            buf = buf.slice(sep + 2)
            for (const line of chunk.split("\n")) {
              const t = line.trim()
              if (!t.startsWith("data:")) continue
              let evt: Record<string, unknown>
              try {
                evt = JSON.parse(t.slice(5).trim())
              } catch {
                continue
              }
              handleEvent(evt)
            }
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return
        setError({ message: (e as Error).message || "Connection lost", partial: true })
        setLiveRegion("Connection lost — suggestions may be incomplete.")
        markPendingRejected()
      } finally {
        setStreaming(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streaming, threadId, subjectType, subjectKey, draft]
  )

  function markPendingRejected() {
    setCards((prev) =>
      prev.map((c) => (c.status === "pending" ? { ...c, status: "rejected" } : c))
    )
  }

  function handleEvent(evt: Record<string, unknown>) {
    const type = evt.type as string
    switch (type) {
      case "thread":
        if (typeof evt.threadId === "string") onThreadReady(evt.threadId)
        break
      case "model":
        setModelTier(String(evt.tier ?? ""))
        if (evt.tier === "auto" || evt.tier === "small" || evt.tier === "medium" || evt.tier === "large") {
          setModelValue(evt.tier)
        }
        break
      case "content":
        if (typeof evt.delta === "string") {
          setLines((prev) => appendAssistantDelta(prev, "text", evt.delta as string))
        }
        break
      case "proposal": {
        const p = validateProposal(evt)
        if (p) {
          setCards((prev) => [...prev, { proposal: p, status: "pending" }])
        } else {
          setLiveRegion("Rejected an invalid proposal event.")
        }
        // The review's findings have arrived → collapse the Thinking panel.
        setReasoningCollapsed(true)
        break
      }
      case "tool":
        if (typeof evt.name === "string" && typeof evt.result === "string") {
          setLog((prev) => [...prev, `${evt.name}: ${evt.result}`])
        }
        break
      case "fiction_review": {
        const r = evt as {
          assessment?: unknown
          noChange?: unknown
          findings?: unknown
        }
        if (typeof r.assessment === "string" && typeof r.noChange === "boolean" && Array.isArray(r.findings)) {
          setFictionReview({
            assessment: r.assessment,
            noChange: r.noChange,
            findings: r.findings
              .filter((f) => f && typeof f === "object")
              .map((f) => ({
                diagnosis: typeof (f as { diagnosis?: unknown }).diagnosis === "string" ? (f as { diagnosis: string }).diagnosis : "",
                principleId: typeof (f as { principleId?: unknown }).principleId === "string" ? (f as { principleId: string }).principleId : "",
                hasEdit: (f as { hasEdit?: unknown }).hasEdit === true,
              })),
          })
        }
        setReasoningCollapsed(true)
        break
      }
      case "reasoning":
        if (typeof evt.delta === "string") {
          setReasoningText((prev) => prev + (evt.delta as string))
        }
        break
      case "done":
        setCards((prev) =>
          prev.map((c) => (c.status === "pending" ? { ...c, status: "applicable" } : c))
        )
        setReasoningCollapsed(true)
        setLiveRegion("Review complete.")
        break
      case "error":
        setError({
          message: typeof evt.message === "string" ? evt.message : "Error",
          partial: evt.partial === true,
        })
        markPendingRejected()
        setLiveRegion(
          evt.partial === true
            ? "Connection lost — suggestions may be incomplete."
            : "Review failed."
        )
        break
    }
  }

  async function handleApply(idx: number) {
    const card = cards[idx]
    if (!card || card.status !== "applicable" || saveInProgress) return
    const res = await onApply(card.proposal)
    setCards((prev) =>
      prev.map((c, i) =>
        i === idx
          ? res.ok
            ? { ...c, status: "applied", undo: res.undo }
            : { ...c, status: "stale" }
          : c
      )
    )
    setLiveRegion(
      res.ok
        ? `Applied ${fieldLabel(card.proposal.field)} edit.`
        : "Draft changed — proposal no longer applies."
    )
  }

  function handleUndo(idx: number) {
    const card = cards[idx]
    if (!card || card.status !== "applied" || !card.undo) return
    onUndo(card.undo)
    setCards((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, status: "applicable" } : c))
    )
    setLiveRegion("Undid edit.")
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setLiveRegion("Copied to clipboard.")
    } catch {
      setLiveRegion("Copy failed.")
    }
  }

  function handleQuickAction(qa: QuickAction) {
    setScope(qa.scope)
    void send(qa.label, qa.scope)
  }

  function handleRefresh(card: ProposalCard) {
    const anchor = card.proposal.original ?? card.proposal.originalValue ?? ""
    void send(`Take another look at: "${anchor.slice(0, 160)}"`, "sentence")
  }

  async function handleModelChange(value: "auto" | "small" | "medium" | "large") {
    if (!threadId) return
    setModelValue(value)
    const res = await setThreadModelPreferenceAction(threadId, value)
    if (!res.success) setLiveRegion("Could not change model.")
  }

  const open = streaming || lines.length > 0

  if (!visible) {
    return (
      <section className="companion companion-collapsed" aria-label="Writing companion">
        <button
          type="button"
          className="companion-open-btn"
          aria-expanded={false}
          aria-controls="companion-body"
          onClick={() => setVisible(true)}
        >
          Show companion{pendingCount > 0 ? ` (${pendingCount} pending)` : ""}
        </button>
      </section>
    )
  }

  return (
    <section className="companion" id="companion-body" aria-label="Writing companion">
      <div className="companion-top">
        <div className="companion-head">
          <span className="companion-title">Writing companion</span>
          <span className="companion-model">model: {modelTier}</span>
          <select
            className="companion-model-select"
            aria-label="Answering model"
            value={modelValue}
            disabled={streaming || !threadId}
            onChange={(e) => void handleModelChange(e.target.value as "auto" | "small" | "medium" | "large")}
          >
            {MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            className="companion-mode-select"
            aria-label="Review mode"
            value={reviewMode}
            disabled={streaming}
            onChange={(e) => setReviewMode(e.target.value as ReviewMode)}
          >
            {REVIEW_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <label className="companion-reasoning-toggle" title="Show the model's reasoning while it thinks">
            <input
              type="checkbox"
              checked={showReasoning}
              onChange={(e) => {
                const v = e.target.checked
                setShowReasoning(v)
                try {
                  localStorage.setItem("companion-show-reasoning", v ? "1" : "0")
                } catch {
                  /* ignore (private mode / disabled storage) */
                }
              }}
            />
            <span>Show reasoning</span>
          </label>
          <button
            type="button"
            className="companion-hide-btn"
            aria-expanded={true}
            aria-controls="companion-body"
            onClick={() => setVisible(false)}
          >
            Hide companion
          </button>
        </div>

        <div className="companion-quick">
          {quickActionsFor(reviewMode).slice(0, 5).map((qa) => (
            <button
              key={qa.label}
              type="button"
              className="companion-quick-btn"
              disabled={streaming}
              onClick={() => handleQuickAction(qa)}
              title={qa.hint}
            >
              {qa.label}
            </button>
          ))}
        </div>
      </div>

      <div className="companion-scroll">
      {streaming && showReasoning && reasoningText && !reasoningCollapsed && (
        <div className="companion-thinking" aria-label="Model reasoning">
          <button
            type="button"
            className="companion-thinking-label"
            aria-expanded={true}
            onClick={() => setReasoningCollapsed(true)}
          >
            <span className="companion-thinking-pulse" aria-hidden="true" />
            Thinking…
          </button>
          <div className="companion-thinking-body">
            {reasoningText}
          </div>
        </div>
      )}
      {streaming && !showReasoning && (
        <p className="companion-working" aria-label="Working">
          <span className="companion-thinking-pulse" aria-hidden="true" />
          Working…
        </p>
      )}
      {streaming && showReasoning && !reasoningText && !reasoningCollapsed && (
        <p className="companion-working" aria-label="Working">
          <span className="companion-thinking-pulse" aria-hidden="true" />
          Working…
        </p>
      )}
      {fictionReview && (
        <div className="companion-fiction-review">
          {fictionReview.noChange ? (
            <p className="companion-review-nochange">NO CHANGE — the draft holds up as written.</p>
          ) : (
            <p className="companion-review-assessment">{fictionReview.assessment}</p>
          )}
          {fictionReview.findings.map((f, i) => (
            <p key={`finding-${i}`} className="companion-review-finding">
              <span className="companion-review-principle">{f.principleId}</span>
              {" — "}
              {f.diagnosis}
              {f.hasEdit ? "" : " (observation)"}
            </p>
          ))}
        </div>
      )}
      <div className="companion-transcript" aria-live="off">
        {lines.map((l, i) =>
          l.role === "user" ? (
            <p key={i} className="companion-user" style={{ whiteSpace: "pre-wrap" }}>
              {l.text}
            </p>
          ) : (
            <MarkdownText key={i} className="companion-assistant">
              {l.text}
            </MarkdownText>
          )
        )}
        {log.map((l, i) => (
          <p key={`log-${i}`} className="companion-log" style={{ whiteSpace: "pre-wrap" }}>
            {l}
          </p>
        ))}
        {error && (
          <p className="companion-error" style={{ whiteSpace: "pre-wrap" }} role="alert">
            {error.partial ? "Connection lost — suggestions may be incomplete. " : ""}
            {error.message}
          </p>
        )}
      </div>

      <div className="companion-cards">
        {cards.map((card, idx) => {
          const p = card.proposal
          const current = p.field === "body" ? p.original : p.originalValue
          const applyLabel = `Apply: replace ${current ?? ""} in ${fieldLabel(p.field)}`
          return (
            <div
              key={p.id}
              className={`companion-card companion-card--${card.status}`}
              data-status={card.status}
            >
              <p className="companion-card-field">{fieldLabel(p.field)}</p>
              <p className="companion-card-diff" style={{ whiteSpace: "pre-wrap" }}>
                <span className="companion-current">{current}</span>
                {" → "}
                <span className="companion-proposed">{p.replacement}</span>
              </p>
              <MarkdownText className="companion-card-rationale">
                {p.rationale}
              </MarkdownText>
              {card.status === "stale" && (
                <p className="companion-stale-msg" role="status">
                  Draft changed — this proposal no longer applies.
                </p>
              )}
              <div className="companion-card-actions">
                {card.status === "applied" ? (
                  <button type="button" onClick={() => handleUndo(idx)} disabled={saveInProgress}>
                    Undo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleApply(idx)}
                    disabled={
                      card.status !== "applicable" || streaming || saveInProgress
                    }
                    aria-disabled={card.status !== "applicable"}
                    aria-label={applyLabel}
                  >
                    {reviewMode === "fiction" && p.field === "title" ? "Try title" : "Apply"}
                  </button>
                )}
                <button type="button" onClick={() => handleCopy(p.replacement)}>
                  Copy
                </button>
                {p.field === "body" && p.original && (
                  <button
                    type="button"
                    onClick={() => onReveal(p.original!)}
                    disabled={streaming}
                  >
                    Reveal in draft
                  </button>
                )}
                {card.status === "stale" && (
                  <button type="button" onClick={() => handleRefresh(card)}>
                    Refresh
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      </div>

      <form
        className="companion-input"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input, scope)
          setInput("")
        }}
      >
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          disabled={streaming}
          aria-label="Review scope"
        >
          <option value="full">full</option>
          <option value="section">section</option>
          <option value="opening">opening</option>
          <option value="sentence">sentence</option>
          <option value="title">title</option>
        </select>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the companion…"
          disabled={streaming}
        />
        <button type="submit" disabled={streaming || !input.trim()}>
          {streaming ? "…" : "Send"}
        </button>
      </form>

      {/* live region: announces streamed errors + applied/stale states (not by color alone) */}
      <div className="companion-live" aria-live="polite">
        {liveRegion}
      </div>
    </section>
  )
}