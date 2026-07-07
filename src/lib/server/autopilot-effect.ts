// ===========================================================================
// Autopilot effect — turns an employee's conversational autopilot decision
// (offer / start) into a chat chip, and (for "start") launches a real
// autonomous session and drives it in the background.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageArtifact } from "@/lib/types";
import { createRuntimeBrain, createSession, driveSession } from "@/lib/autonomy";
import { loadWorkspaceAiSettings } from "@/lib/supabase/ai-runtime";
import { uid } from "@/lib/utils";

/** Resolve the employee who should run the objective (self by default). */
export async function resolveAutopilotEmployee(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  employeeName: string,
  selfId: string,
): Promise<{ id: string; name: string }> {
  const { data: members } = await client
    .from("room_members")
    .select("member_id")
    .eq("workspace_id", workspaceId)
    .eq("room_id", roomId)
    .eq("member_type", "ai");
  const memberIds = ((members as Array<{ member_id: string }> | null) ?? []).map((m) => String(m.member_id));

  const { data } = await client
    .from("ai_employees")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .ilike("name", `%${employeeName.trim()}%`)
    .limit(5);
  const match = ((data as Array<{ id: string; name: string }> | null) ?? []).find((e) =>
    memberIds.includes(String(e.id)),
  );
  if (match) return { id: String(match.id), name: String(match.name) };

  const { data: self } = await client
    .from("ai_employees")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("id", selfId)
    .maybeSingle();
  return { id: selfId, name: self?.name ? String(self.name) : "AI employee" };
}

export type HandleAutopilotParams = {
  workspaceId: string;
  roomId: string;
  topicId: string;
  objective: string;
  mode: "offer" | "start";
  runnerId: string;
  runnerName: string;
  createdByUserId?: string;
};

export async function handleAutopilotEffect(
  client: SupabaseClient,
  params: HandleAutopilotParams,
): Promise<MessageArtifact | null> {
  const objective = params.objective.trim();
  if (!objective) return null;

  if (params.mode === "start") {
    const settings = await loadWorkspaceAiSettings(client, params.workspaceId).catch(() => null);
    const session = await createSession(client, {
      workspaceId: params.workspaceId,
      employeeId: params.runnerId,
      objective,
      roomId: params.roomId,
      topicId: params.topicId,
      createdByUserId: params.createdByUserId,
      stepBudget: settings?.autonomyStepBudget,
      costBudgetUsd: settings?.autonomyCostBudgetUsd,
    });
    // Fire-and-forget the first drive; the session poll endpoint resumes it if
    // this background task is cut short (serverless-safe).
    const brain = createRuntimeBrain({ workspaceId: params.workspaceId, employeeId: params.runnerId });
    void driveSession(client, session.id, brain).catch((err) =>
      console.warn("[AdeHQ autopilot-effect] drive failed", err),
    );
    return {
      type: "autonomous_session",
      id: session.id,
      label: `Autopilot: ${objective.slice(0, 48)}${objective.length > 48 ? "…" : ""}`,
    };
  }

  // offer
  return {
    type: "autopilot_offer",
    id: uid("apo"),
    label: objective.slice(0, 72),
    meta: {
      objective,
      autopilotEmployeeId: params.runnerId,
      createdByName: params.runnerName,
    },
  };
}
