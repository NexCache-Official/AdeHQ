// ===========================================================================
// AdeHQ teamwork adapter — team.suggestColleagues + team.coordinate.
// Lets an employee delegate to / coordinate with another AI employee by
// finding a shared room and bringing the work up there (never in DMs).
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionContext, ToolExecutionOutput } from "@/lib/integrations/types";
import type { CoordinateArgs, SuggestColleaguesArgs } from "@/lib/integrations/registry/tool-definitions";
import { coordinateWithColleague, suggestColleagues as suggestColleaguesFn } from "@/lib/server/team-coordination";

export async function suggestColleagues(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: SuggestColleaguesArgs,
): Promise<ToolExecutionOutput> {
  let colleagues = await suggestColleaguesFn(client, ctx.workspaceId, ctx.employeeId);
  const needle = [args.role, args.skill].filter(Boolean).join(" ").toLowerCase().trim();
  if (needle) {
    const filtered = colleagues.filter(
      (c) => c.role.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle),
    );
    if (filtered.length) colleagues = filtered;
  }
  return {
    summary: `Found ${colleagues.length} teammate${colleagues.length === 1 ? "" : "s"}${
      colleagues.some((c) => c.sharedRoom) ? "" : " (none share a room with you yet)"
    }.`,
    payload: { colleagues },
  };
}

export async function coordinate(
  client: SupabaseClient,
  ctx: ToolExecutionContext,
  args: CoordinateArgs,
): Promise<ToolExecutionOutput> {
  const result = await coordinateWithColleague(client, {
    workspaceId: ctx.workspaceId,
    sourceEmployeeId: ctx.employeeId,
    sourceEmployeeName: ctx.employeeName ?? "A teammate",
    targetEmployeeId: args.employeeId,
    targetEmployeeName: args.employeeName,
    message: args.message,
    topicHint: args.topicHint,
    currentAgentRunId: ctx.agentRunId,
  });

  if (!result.ok) {
    // Surface as a soft failure so the employee can tell the user honestly.
    throw new Error(result.reason ?? "Couldn't coordinate right now.");
  }

  const where = `${result.roomName}${result.topicTitle ? ` · ${result.topicTitle}` : ""}`;
  const followUpNote =
    result.drainedFollowUpRuns && result.drainedFollowUpRuns > 0
      ? ` ${result.drainedFollowUpRuns} follow-up run${result.drainedFollowUpRuns === 1 ? "" : "s"} continued in the background.`
      : "";
  return {
    summary: result.targetResponded
      ? `Brought ${result.targetEmployeeName} in on it in ${where} — they're on it.${followUpNote}`
      : `Started a thread with ${result.targetEmployeeName} in ${where}.${followUpNote}`,
    payload: {
      roomId: result.roomId,
      topicId: result.topicId,
      roomName: result.roomName,
      topicTitle: result.topicTitle,
      targetEmployeeName: result.targetEmployeeName,
      targetResponded: result.targetResponded,
      drainedFollowUpRuns: result.drainedFollowUpRuns,
    },
    objectId: result.roomId,
    workLogAction: "coordinated_with_teammate",
  };
}
