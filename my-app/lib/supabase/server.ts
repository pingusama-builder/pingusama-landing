import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import ws from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";

// Node 20 has no native WebSocket, so supabase-js's eager realtime-client
// construction throws unless we hand it an explicit transport. `ws` is a
// direct dependency; this also works on Node 22+ (Vercel), where it is a no-op.
const realtime = { transport: ws as unknown as WebSocketLikeConstructor };

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      realtime,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )
}

export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      realtime,
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    }
  )
}