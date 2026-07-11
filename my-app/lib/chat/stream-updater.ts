// Pure state-updater helpers for streaming transcripts (chat + blog companion).
//
// React StrictMode double-invokes state updater functions in development. These
// helpers MUST be pure — never mutate `lines` or any element of it — so that a
// double-invoke is idempotent. An impure updater that does `last.text += delta`
// on a shallow-copied array (`[...prev]`) mutates the shared last element; the
// second invoke then appends the delta AGAIN, so every streamed token is
// duplicated in the transcript (e.g. "FFINDINGS / INDINGS"). Returning a new
// last element makes double-invoke produce the same single result. StrictMode
// does not double-invoke in production, so the duplication is dev-only — but
// the impurity is a real bug regardless, and it makes local eval impossible.

export type LineRole = "user" | "assistant" | "tool"

/**
 * Append a streamed text delta to the last line iff it is an assistant line.
 * Pure: returns a new array with a new last element; never mutates `lines`.
 * If the last line is not an assistant line, returns `lines` unchanged.
 *
 * `field` selects the text property to append to ("text" for the companion
 * transcript, "content" for the chat UI's UIMessage).
 */
export function appendAssistantDelta<
  T extends { role: LineRole },
  K extends keyof T & string,
>(lines: T[], field: K, delta: string): T[] {
  const last = lines[lines.length - 1]
  if (!last || last.role !== "assistant") return lines
  const prev = (last[field] as unknown as string) ?? ""
  const updated = { ...last, [field]: prev + delta } as T
  return [...lines.slice(0, -1), updated]
}