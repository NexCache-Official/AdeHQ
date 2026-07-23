/**
 * PR-18.2A8 — Post-turn async effect compiler.
 * Speech/DM stream first; routine work-log / memory / task suggestions after.
 * Never moves required tool mutations or approvals off the critical path.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type AsyncEffectCompilerInput = {
  client: SupabaseClient;
  workspaceId: string;
  roomId: string;
  topicId: string;
  employeeId: string;
  employeeName: string;
  humanUserId: string;
  callId: string;
  turnId: string;
  userMessage: string;
  employeeReply: string;
  route: "local_instant" | "voice_fast" | "work_full";
};

/**
 * Fire-and-forget enrichment after the spoken answer is already streaming/done.
 * Failures are logged and never surface to the caller.
 */
export function scheduleVoiceAsyncEffects(input: AsyncEffectCompilerInput): void {
  if (process.env.ADEHQ_VOICE_ASYNC_EFFECTS === "0") return;
  void compileVoiceAsyncEffects(input).catch((error) => {
    console.warn("[AdeHQ voice-async-effects]", {
      callId: input.callId,
      turnId: input.turnId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function compileVoiceAsyncEffects(
  input: AsyncEffectCompilerInput,
): Promise<{
  workLogSuggestion: string | null;
  memorySuggestion: string | null;
  taskSuggestion: string | null;
  summaryLine: string;
}> {
  const summaryLine = `${input.employeeName} (call): ${input.employeeReply
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)}`;

  // Lightweight heuristic suggestions only — no second LLM on the hot path.
  const memorySuggestion =
    input.route !== "local_instant" &&
    /\b(?:remember|note that|my preference|always|don't|do not)\b/i.test(
      input.userMessage,
    )
      ? input.userMessage.trim().slice(0, 240)
      : null;

  const taskSuggestion =
    input.route === "voice_fast" &&
    /\b(?:remind me|follow up|todo|to-do|next step|schedule)\b/i.test(
      `${input.userMessage} ${input.employeeReply}`,
    )
      ? `Follow up from call: ${input.userMessage.trim().slice(0, 120)}`
      : null;

  const workLogSuggestion =
    input.route === "local_instant"
      ? null
      : `Call turn with ${input.employeeName}: answered "${input.userMessage
          .trim()
          .slice(0, 80)}"`;

  // Persist a compact call-summary breadcrumb on the turn metadata only when
  // the call_turns row already exists (best-effort).
  try {
    await input.client
      .from("call_turns")
      .update({
        metadata: {
          asyncEffects: {
            summaryLine,
            workLogSuggestion,
            memorySuggestion,
            taskSuggestion,
            compiledAt: new Date().toISOString(),
          },
        },
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.turnId);
  } catch {
    // Best-effort only.
  }

  return {
    workLogSuggestion,
    memorySuggestion,
    taskSuggestion,
    summaryLine,
  };
}
