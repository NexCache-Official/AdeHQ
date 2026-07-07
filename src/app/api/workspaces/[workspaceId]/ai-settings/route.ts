import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import {
  loadWorkspaceAiSettings,
  updateWorkspaceAiSettings,
} from "@/lib/supabase/ai-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const settings = await loadWorkspaceAiSettings(client, params.workspaceId);
    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ ai-settings GET]", error);
    return NextResponse.json({ error: "Unable to load AI settings." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const { role } = await requireWorkspaceMembership(client, params.workspaceId, user.id);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const body = await request.json();
    const settings = await updateWorkspaceAiSettings(client, params.workspaceId, {
      aiEnabled: body.aiEnabled,
      defaultProvider: body.defaultProvider,
      dailyTokenLimit: body.dailyTokenLimit,
      dailyCostLimitUsd: body.dailyCostLimitUsd,
      employeeDailyTokenLimit: body.employeeDailyTokenLimit,
      maxParallelRuns: body.maxParallelRuns,
      maxOutputTokens: body.maxOutputTokens,
      maxToolRunsPerTask: body.maxToolRunsPerTask,
      maxHandoffDepth: body.maxHandoffDepth,
      autonomyStepBudget: body.autonomyStepBudget,
      autonomyCostBudgetUsd: body.autonomyCostBudgetUsd,
    });

    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ ai-settings PATCH]", error);
    return NextResponse.json({ error: "Unable to update AI settings." }, { status: 500 });
  }
}
