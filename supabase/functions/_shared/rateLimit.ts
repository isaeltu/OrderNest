// Minimal Upstash Redis REST client for rate limiting Edge Functions. Upstash
// exposes a plain HTTP API (no TCP socket needed), which is the only way to
// reach Redis from a Deno edge runtime. Uses a fixed one-minute window via
// INCR + EXPIRE -- good enough for abuse protection, no extra dependency.
//
// This is a *second* layer in front of the Postgres-native rate limiting
// already applied inside the RPCs themselves (see
// supabase/migrations/202606270004_anon_rpc_rate_limiting.sql): this one
// rejects fast, before a database round trip, for traffic that goes through
// an Edge Function. The Postgres layer is what actually can't be bypassed,
// since some of these RPCs (the WhatsApp bot ones) are called directly via
// PostgREST and never pass through an Edge Function at all.

const UPSTASH_URL = Deno.env.get("UPSTASH_REDIS_REST_URL");
const UPSTASH_TOKEN = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");

export async function checkRateLimit(key: string, maxPerMinute: number): Promise<boolean> {
  // Fail-open: if Redis isn't configured or is unreachable, let the request
  // through. A Redis outage should never block real orders/notifications --
  // the Postgres-layer limiter is still there as the real backstop.
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return true;

  const windowId = Math.floor(Date.now() / 60_000);
  const redisKey = `ratelimit:${key}:${windowId}`;

  try {
    const response = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, "70"],
      ]),
    });

    if (!response.ok) return true;

    const result = await response.json();
    const count = result?.[0]?.result;
    return typeof count !== "number" || count <= maxPerMinute;
  } catch {
    return true;
  }
}
