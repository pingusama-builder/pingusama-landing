# Current route shapes and security boundary (verbatim excerpts)

## /api/chat route loop (my-app/app/api/chat/route.ts)

```ts
const MAX_TURNS = 6
const MAX_MEMORY_WRITES = 3

const history = historyRows.map(rowToMistral).filter((m): m is MistralMessage => m !== null)
const mistralMessages: MistralMessage[] = [
  { role: "system", content: systemPrompt },
  ...history.slice(0, -1),
  { role: "user", content: message },
]

while (turns < MAX_TURNS) {
  const acc = await mistralStream({
    messages: mistralMessages,
    tools: CHAT_TOOLS,          // only memory + read tools
    model: modelId,
    maxTokens: ...,
    onContent: (delta) => send({ type: "content", delta }),
  })
  // persist assistant, optionally execute tool calls, loop
}
```

## /api/blog-companion route loop (my-app/app/api/blog-companion/route.ts)

```ts
const MAX_TURNS = 3
const MAX_PROPOSALS_PER_TURN = 8
const tools = companionToolsFor(reviewMode)

const acc = await mistralStream({
  messages: mistralMessages,
  tools,
  model: modelId,
  maxTokens: ...,
  signal: request.signal,
  onContent: (delta) => { emitted = true; forwardContent(delta) },
  onReasoning: (delta) => send({ type: "reasoning", delta }),
})

// execute allowed tools, emit proposals
```

## Security guarantee (verbatim from route comments)

> The dispatch allowlist (`COMPANION_ALLOWED`) is the security boundary; `propose_edit` is pure. The publish path is already XSS-sanitized (`parseMarkdown` + `rehypeSanitize`) — verified by tests in Task 13, not rebuilt here.

> This route imports ONLY the chat data layer (read + constrained write + thread helpers), `buildWritingContext` (read), `mistralStream`, the model plumbing, and the companion tool dispatcher. It does NOT import `savePostAction` / `createPost` / `updatePost` / `deletePost`, storage/bench/shelf write modules, or the generic `lib/supabase/server` service client.
