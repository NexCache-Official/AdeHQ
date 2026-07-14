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

/**
 * workLogAction values that real tool adapters emit on a genuinely successful
 * DB write (see `workLogAction:` in src/lib/integrations/adapters/*.ts). A
 * model can freely put an `action` string matching one of these into
 * effects.workLog without ever calling the matching tool — that's the
 * fabricated-success bug this module guards against. Any workLog draft whose
 * `action` is in this set must be backed by a real tool result this turn.
 */
export const TOOL_BACKED_WORK_LOG_ACTIONS = new Set([
  "content_campaign_reused",
  "content_campaign_created",
  "content_post_drafted",
  "content_post_scheduled",
  "crm_contact_reused",
  "crm_contact_created",
  "crm_company_reused",
  "crm_company_created",
  "crm_deal_created",
  "crm_deal_stage_updated",
  "investor_firm_reused",
  "investor_firm_created",
  "investor_contact_reused",
  "investor_contact_created",
  "investor_pipeline_updated",
  "investor_pipeline_fit_scored",
  "investor_follow_up_created",
  "created_email_draft",
  "coordinated_with_teammate",
  "task_created",
]);

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
  /**
   * effects.workLog entries claiming a tool-backed action (see
   * TOOL_BACKED_WORK_LOG_ACTIONS) that were NOT backed by a matching
   * successful tool result this turn — i.e. the model narrated a CRM/task/
   * artifact action instead of actually calling the tool. These are dropped
   * before insert (see room-messages.ts), so this count is the only trace.
   */
  fabricatedToolClaimCount: number;
};

export type ReconcileClaimedActionsResult = {
  reply: string;
  /** Notice chip to append when a false completion claim was corrected. */
  notice?: MessageArtifact;
  falseClaim: boolean;
};

// Past-tense ("created X") AND present-continuous ("creating X") both read as an
// active claim of action in chat vernacular when NOT preceded by an intent marker
// (see INTENT_PREFIX below) — e.g. "Adding Marcus Webb to the CRM" standing alone
// reads exactly like "Added Marcus Webb", but a bare past-tense-only list misses it.
const COMPLETION_VERB =
  "(?:created|creating|added|adding|logged|logging|drafted|drafting|generated|generating|saved|saving|scheduled|scheduling|set up|setting up|set a|built|building|registered|registering|entered|entering|prepared|preparing|updated|updating|synced|syncing|pushed|pushing)";

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
  "I wasn't able to actually complete those actions just now — nothing was saved to your CRM, tasks, or Drive. This was a tool execution issue on my side, not a problem with your request.";

const HONEST_REPLY_PARTIAL =
  "One of the actions I described didn't actually run, so part of this wasn't saved — check the cards below for what did and didn't go through.";

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

  // Direct evidence beats the reply-text heuristic below: the model narrated
  // a specific tool-backed action (e.g. "created contact") in effects.workLog
  // without the matching tool call ever succeeding. Correct this even when
  // other genuine effects (memory, an unrelated task) happened in the same
  // turn — those don't make the fabricated claim any less false — but say so
  // honestly instead of claiming "nothing was saved" next to a success card.
  if (counts.fabricatedToolClaimCount > 0) {
    return {
      reply: producedRealEffect ? HONEST_REPLY_PARTIAL : HONEST_REPLY,
      notice: {
        type: "tool_result",
        id: `fabricated-claim-${options?.triggerMessageId ?? Math.random().toString(36).slice(2)}`,
        label: "Actions not completed",
        meta: {
          toolStatus: "failed",
          retryKind: "employee_reply",
          triggerMessageId: options?.triggerMessageId,
          error: "The assistant described a CRM/task/artifact action it did not actually run, so nothing was saved.",
          subtitle: producedRealEffect
            ? "One action wasn't saved — see the other cards for what succeeded."
            : "Nothing was saved.",
        },
      },
      falseClaim: true,
    };
  }

  if (producedRealEffect) {
    if (
      counts.toolFailureCount > 0 &&
      replyClaimsCompletedAction(reply) &&
      !/\b(failed|couldn'?t|could not|wasn'?t able|some actions failed)\b/i.test(reply)
    ) {
      return {
        reply: `${reply}\n\nSome actions failed — see the cards below for details.`,
        falseClaim: true,
      };
    }
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
            toolStatus: "failed",
            retryKind: "employee_reply",
            triggerMessageId: options?.triggerMessageId,
            error:
              "The assistant described actions it did not actually run, so nothing was saved.",
            subtitle: "Nothing was saved to CRM, Tasks, or Drive.",
          },
        };

  return { reply: HONEST_REPLY, notice, falseClaim: true };
}

const MEMORY_SAVE_CLAIM =
  /\b(i'?ve\s+saved|i\s+saved|saved\s+that|saved\s+this|saved\s+as\s+durable|locked\s+(?:that|it|this)\s+in|noted\s+in\s+memory|added\s+to\s+memory|stored\s+in\s+memory|saved\s+to\s+memory)\b/i;

/**
 * Strip or rewrite claims that memory / "durable context" was saved when nothing
 * was actually written to memory_entries this turn.
 */
export function scrubFalseMemoryClaims(reply: string, memoryCount: number): string {
  if (memoryCount > 0) return reply;
  if (!MEMORY_SAVE_CLAIM.test(reply) && !/durable context/i.test(reply)) {
    return reply;
  }

  const cleaned = reply
    .replace(
      /[^.!?\n]{0,40}(?:saved|locked in|stored)[^.!?\n]{0,80}(?:memory|durable context)[^.!?\n]*[.!?]?\s*/gi,
      "",
    )
    .replace(/\bdurable context\b/gi, "context")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!cleaned) {
    return "Noted — I can suggest this for memory if you want it saved for later.";
  }

  if (!/suggest(?:ion)? for memory|save (?:this )?to memory|memory suggestion/i.test(cleaned)) {
    return `${cleaned}${/[.!?]$/.test(cleaned) ? "" : "."} (Not saved to memory yet — use Save memory if you want it kept.)`;
  }
  return cleaned;
}
