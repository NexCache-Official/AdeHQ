// ===========================================================================
// Honesty guardrail — detect when an employee reply CLAIMS it completed
// tool-backed actions (created a contact, logged a deal, drafted an email,
// generated a spreadsheet, etc.) but no backing effect was actually produced.
//
// Weak models sometimes narrate "Done. Created X, added Y…" without emitting
// effects.toolCalls, so nothing persists and the chat shows a false success.
// This module rewrites those replies to be honest and surfaces a retry chip.
// ===========================================================================

import type { MessageArtifact } from "@/lib/types";

/** Count of what actually persisted for a single employee response. */
export type PersistedActionCounts = {
  /** Tool calls that executed successfully. */
  toolSuccessCount: number;
  /** Tool calls that returned approval_pending / queued (legit in-progress). */
  toolPendingCount: number;
  /** Tool calls that blocked or failed (user already sees a failure chip). */
  toolFailureCount: number;
  emailDraftCount: number;
  taskCount: number;
  artifactCount: number;
  approvalCount: number;
  memoryCount: number;
};

export type ReconcileClaimedActionsResult = {
  reply: string;
  /** Notice chip to append when a false completion claim was corrected. */
  notice?: MessageArtifact;
  falseClaim: boolean;
};

const COMPLETION_VERB =
  "(?:created|added|logged|drafted|generated|saved|scheduled|set up|set a|built|registered|entered|prepared|updated|synced|pushed)";

const TOOL_NOUN =
  "(?:compan(?:y|ies)|contacts?|deals?|tasks?|follow[- ]?ups?|emails?|drafts?|spreadsheets?|workbooks?|pdfs?|reports?|pipelines?|records?|campaigns?|briefs?|crm)";

// "I'll create", "I can add", "let me draft", "happy to set up" — intent, not a claim.
const INTENT_PREFIX = /\b(?:i'?ll|i will|i can|i could|i would|let me|happy to|going to|about to|planning to|ready to|i'?m going to)\s+\w*\s*$/i;

const CLAIM_PATTERN = new RegExp(
  `\\b${COMPLETION_VERB}\\b[^.!?\\n]{0,60}?\\b${TOOL_NOUN}\\b`,
  "i",
);

/** True when the reply asserts (past tense) that a tool-backed action is done. */
export function replyClaimsCompletedAction(reply: string): boolean {
  const match = CLAIM_PATTERN.exec(reply);
  if (!match) return false;
  // Reject if the matched verb is preceded by an intent/future marker.
  const before = reply.slice(0, match.index);
  if (INTENT_PREFIX.test(before)) return false;
  return true;
}

const HONEST_REPLY =
  "I wasn't able to actually complete those actions just now — nothing was saved to your CRM, tasks, or Drive. This was a tool execution issue on my side, not a problem with your request. Want me to try again?";

/**
 * Compare a reply's completion claims against what actually persisted.
 * When the reply claims success but nothing real happened, return an honest
 * reply plus a notice chip. Otherwise the original reply passes through.
 */
export function reconcileClaimedActions(
  reply: string,
  counts: PersistedActionCounts,
  options?: { triggerMessageId?: string },
): ReconcileClaimedActionsResult {
  const producedRealEffect =
    counts.toolSuccessCount > 0 ||
    counts.toolPendingCount > 0 ||
    counts.emailDraftCount > 0 ||
    counts.taskCount > 0 ||
    counts.artifactCount > 0 ||
    counts.approvalCount > 0 ||
    counts.memoryCount > 0;

  if (producedRealEffect) {
    return { reply, falseClaim: false };
  }

  if (!replyClaimsCompletedAction(reply)) {
    return { reply, falseClaim: false };
  }

  // The reply claims completed actions, yet nothing persisted. If tools were
  // attempted and failed, the failure chips already explain it — still correct
  // the misleading text, but don't stack a duplicate generic notice.
  const notice: MessageArtifact | undefined =
    counts.toolFailureCount > 0
      ? undefined
      : {
          type: "tool_result",
          id: `no-op-${options?.triggerMessageId ?? Math.random().toString(36).slice(2)}`,
          label: "Actions not completed",
          meta: {
            toolName: "assistant",
            toolStatus: "failed",
            error:
              "The assistant described actions it did not actually run, so nothing was saved.",
            subtitle: "Nothing was saved to CRM, Tasks, or Drive. Ask again to retry.",
          },
        };

  return { reply: HONEST_REPLY, notice, falseClaim: true };
}
