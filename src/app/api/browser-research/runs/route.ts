import { NextRequest, NextResponse } from "next/server";
import {
  browserResearchCompletedMessage,
  BrowserResearchPermissionError,
  getBrowserResearchProviderConfig,
} from "@/lib/ai/browser-research";
import { resolveResearchQuery } from "@/lib/ai/research";
import {
  createAndRunBrowserResearch,
  listBrowserResearchRuns,
} from "@/lib/ai/browser-research/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { isPlatformFlagEnabled, preloadPlatformFlags } from "@/lib/admin/platform-flags";
import { PlanEntitlementError } from "@/lib/billing/plans/entitlements";
import type { RoomMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = {
  workspaceId?: string;
  roomId?: string | null;
  topicId?: string | null;
  employeeId?: string;
  query?: string;
  triggerMessageId?: string;
};

function messageFromRow(row: Record<string, unknown>): RoomMessage {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    senderType: row.sender_type as RoomMessage["senderType"],
    senderId: String(row.sender_id),
    senderName: String(row.sender_name ?? "User"),
    content: String(row.content ?? ""),
    createdAt: String(row.created_at),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateBody;
    const workspaceId = body.workspaceId?.trim();
    const employeeId = body.employeeId?.trim();
    let query = body.query?.trim() ?? "";
    const triggerMessageId = body.triggerMessageId?.trim();

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required." }, { status: 400 });
    }

    const { user, client } = await requireAuthUser(request);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    let userQuestion = query;
    if (triggerMessageId && body.topicId?.trim()) {
      const topicId = body.topicId.trim();
      const { data: rows } = await client
        .from("messages")
        .select("id, room_id, topic_id, sender_type, sender_id, sender_name, content, created_at")
        .eq("workspace_id", workspaceId)
        .eq("topic_id", topicId)
        .order("created_at", { ascending: true })
        .limit(40);

      const messages = ((rows ?? []) as Record<string, unknown>[]).map(messageFromRow);
      const trigger = messages.find((message) => message.id === triggerMessageId);
      const userMessage = trigger?.content ?? query;
      const resolved = resolveResearchQuery({
        messages,
        userMessage,
        excludeMessageId: triggerMessageId,
      });
      query = resolved.query;
      userQuestion = resolved.userQuestion;
    }

    if (!query) {
      return NextResponse.json({ error: "query is required." }, { status: 400 });
    }

    const serviceClient = createSupabaseSecretClient();
    await preloadPlatformFlags(serviceClient);

    if (!(await isPlatformFlagEnabled("browser_research_enabled", serviceClient))) {
      return NextResponse.json(
        { error: "Browser research is temporarily disabled." },
        { status: 503 },
      );
    }

    // Browser research is a paid feature; createAndRunBrowserResearch enforces the plan
    // entitlement (throws PlanEntitlementError -> 402 below) so all callers stay gated.
    const { run, chatReply, async: isAsync } = await createAndRunBrowserResearch(serviceClient, {
      workspaceId,
      roomId: body.roomId?.trim() || undefined,
      topicId: body.topicId?.trim() || undefined,
      employeeId,
      createdBy: user.id,
      query,
      triggerMessageId,
      userQuestion,
      resolvedFrom: triggerMessageId ? "thread" : undefined,
    });

    return NextResponse.json({
      run,
      chatReply,
      async: isAsync,
      resolvedQuery: query,
      message: isAsync
        ? "Live browser research started."
        : browserResearchCompletedMessage(run.provider),
      config: getBrowserResearchProviderConfig(),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof BrowserResearchPermissionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof PlanEntitlementError) {
      return NextResponse.json(
        { error: error.message, code: error.code, feature: error.feature },
        { status: error.status },
      );
    }
    const message = error instanceof Error ? error.message : "Failed to create research run.";
    if (message.includes("SECRET_KEY") || message.includes("secret key")) {
      return NextResponse.json(
        {
          error:
            "Server configuration incomplete. Set SUPABASE_SECRET_KEY (sb_secret_…) in Vercel environment variables.",
        },
        { status: 503 },
      );
    }
    console.error("[AdeHQ browser research POST]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    const topicId = request.nextUrl.searchParams.get("topicId")?.trim();
    const employeeId = request.nextUrl.searchParams.get("employeeId")?.trim();

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const { user, client } = await requireAuthUser(request);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const runs = await listBrowserResearchRuns(client, {
      workspaceId,
      topicId: topicId || undefined,
      employeeId: employeeId || undefined,
      limit: 20,
    });

    return NextResponse.json({
      runs,
      config: getBrowserResearchProviderConfig(),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to list research runs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
