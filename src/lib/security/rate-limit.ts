import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function requestIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Durable sliding-window limiter backed by Supabase.
 *
 * This intentionally uses append-only events instead of an in-memory counter so
 * limits are shared across Vercel instances. A tiny amount of concurrent
 * overrun is possible without a database lock; downstream AI/email hard caps
 * remain the final resource boundary.
 */
export async function consumeRateLimit(
  client: SupabaseClient,
  params: {
    bucket: string;
    key: string;
    limit: number;
    windowMs: number;
  },
): Promise<RateLimitResult> {
  const now = Date.now();
  const since = new Date(now - params.windowMs).toISOString();
  const keyHash = hashKey(params.key);

  const { error: insertError } = await client
    .from("security_rate_limit_events")
    .insert({ bucket: params.bucket, key_hash: keyHash });
  if (insertError) throw insertError;

  const { count, error: countError } = await client
    .from("security_rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("bucket", params.bucket)
    .eq("key_hash", keyHash)
    .gte("created_at", since);
  if (countError) throw countError;

  const used = count ?? params.limit + 1;
  const allowed = used <= params.limit;

  // Opportunistic bounded cleanup; failure does not weaken enforcement.
  void client
    .from("security_rate_limit_events")
    .delete()
    .eq("bucket", params.bucket)
    .eq("key_hash", keyHash)
    .lt("created_at", new Date(now - params.windowMs * 2).toISOString());

  return {
    allowed,
    limit: params.limit,
    remaining: Math.max(0, params.limit - used),
    retryAfterSeconds: Math.max(1, Math.ceil(params.windowMs / 1000)),
  };
}

export function rateLimitResponse(
  result: RateLimitResult,
  message = "Too many requests. Please try again later.",
): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}
