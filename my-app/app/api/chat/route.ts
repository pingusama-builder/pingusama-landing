import { getCurrentUser, isAdmin } from "@/lib/auth"
import { runChatTurn, type TurnEvent, type ChatRequestBody } from "@/lib/chat/chat-turn"

export const maxDuration = 60
export const runtime = "nodejs"

// The chat route is a thin HTTP/SSE translator. Everything past "authenticated
// + parsed body" — thread lifecycle, resume resolution, the external-verification
// suggestion pause, model resolution, the web research pipeline, the agent
// loop, persistence, graceful degrade — lives in the chat-turn module
// (lib/chat/chat-turn.ts). Its interface (runChatTurn → TurnResult) is the test
// surface for the round-7 contract. See my-app/CONTEXT.md §chat turn.

export async function POST(request: Request) {
  // ── Admin gate (the API route is NOT under /admin/, so middleware doesn't cover it) ──
  const user = await getCurrentUser()
  if (!user || !isAdmin(user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: ChatRequestBody
  try {
    body = (await request.json()) as ChatRequestBody
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const result = await runChatTurn({ body, userId: user.id })

  // Translate the discriminated TurnResult to an HTTP/SSE response.
  if (result.kind === "httpError") {
    return Response.json({ error: result.error }, { status: result.status })
  }
  if (result.kind === "paused") {
    return Response.json({ threadId: result.threadId, pendingChoice: result.pendingChoice })
  }

  // result.kind === "stream" — map the typed TurnEvent stream to SSE frames.
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of result.events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
      } catch {
        // The producer pushes its own {type:"error"} on failure; if the
        // consumer itself throws, just close without crashing the response.
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-vercel-no-loop": "1",
    },
  })
}