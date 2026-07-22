import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getCall, resolveHumanCallEntitlements } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    const callId = request.nextUrl.searchParams.get("callId");
    const forceRelay = request.nextUrl.searchParams.get("forceRelay") === "1";
    if (!workspaceId || !callId) throw new AuthError("workspaceId and callId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const call = await getCall(service, workspaceId, callId);
    if (!call.participants.some((participant) => participant.userId === user.id)) {
      throw new AuthError("Call not found.", 404);
    }
    const entitlements = await resolveHumanCallEntitlements(service, workspaceId);
    if (forceRelay && !entitlements.forceRelayAvailable) {
      throw new AuthError("Force relay is not available for this workspace.", 403);
    }
    const keyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
    const token = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
    if (!keyId || !token) {
      if (forceRelay) {
        throw new AuthError("Force relay requires Cloudflare TURN to be configured.", 503);
      }
      return NextResponse.json({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        iceTransportPolicy: "all",
        turnConfigured: false,
      });
    }
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 3600, customIdentifier: `${workspaceId}:${user.id}` }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      iceServers?: RTCIceServer[];
      errorDescription?: string;
    };
    if (!response.ok || !body.iceServers) {
      throw new Error(body.errorDescription || "TURN credential generation failed.");
    }
    return NextResponse.json({
      iceServers: body.iceServers.map((server) => ({
        ...server,
        urls: Array.isArray(server.urls)
          ? server.urls.filter((url) => !url.includes(":53"))
          : server.urls,
      })),
      iceTransportPolicy: forceRelay ? "relay" : "all",
      turnConfigured: true,
      expiresIn: 3600,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate TURN credentials." },
      { status: 502 },
    );
  }
}
