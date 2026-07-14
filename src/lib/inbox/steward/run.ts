/**
 * Run triage for one inbound message. Never starts a draft model.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordEmailEvent } from "@/lib/inbox/audit";
import { recordShadowWorkMinutes } from "@/lib/ai/work-hours/ledger";
import { resolveAndLinkThreadContact } from "@/lib/inbox/crm-resolve";
import { applyMailboxRules } from "@/lib/inbox/rules/evaluate";
import { triageWithRules, type TriageMessageInput } from "./heuristics";
import { decideAssignment, loadEligibleEmployees } from "./assign";
import { maybeClassifyWithModel } from "./classify";
import { TRIAGE_VERSION } from "./types";
import type { EmailTriageResult } from "./types";

export async function runTriageForMessage(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    mailboxId: string;
    threadId: string;
    messageId: string;
    jobId?: string;
  },
): Promise<EmailTriageResult> {
  await client
    .from("email_threads")
    .update({ triage_status: "running" })
    .eq("id", params.threadId);

  try {
    const { data: mailbox } = await client
      .from("workspace_mailboxes")
      .select("assistance_mode, assign_threshold, max_classifier_body_chars")
      .eq("id", params.mailboxId)
      .maybeSingle();

    const mode = String(mailbox?.assistance_mode ?? "manual");
    if (mode === "manual") {
      await client
        .from("email_threads")
        .update({ triage_status: "not_started" })
        .eq("id", params.threadId);
      return {
        category: "general",
        priority: "normal",
        replyRequired: false,
        confidence: 0,
        assignmentConfidence: 0,
        keyPoints: [],
        safetyFlags: [],
        source: "rules",
      };
    }

    const { data: message, error: msgErr } = await client
      .from("email_messages")
      .select(
        "from_address, from_name, to_addresses, subject, text_body, html_body_sanitised, security_flags, headers",
      )
      .eq("id", params.messageId)
      .maybeSingle();
    if (msgErr) throw msgErr;
    if (!message) throw new Error("Message not found for triage");

    const { count: attCount } = await client
      .from("email_attachments")
      .select("id", { count: "exact", head: true })
      .eq("message_id", params.messageId);

    const input: TriageMessageInput = {
      fromAddress: (message.from_address as string) ?? null,
      fromName: (message.from_name as string) ?? null,
      to: (message.to_addresses as string[]) ?? [],
      subject: String(message.subject ?? ""),
      textBody: (message.text_body as string) ?? null,
      htmlSanitised: (message.html_body_sanitised as string) ?? null,
      securityFlags: (message.security_flags as string[]) ?? [],
      hasAttachments: (attCount ?? 0) > 0,
      headers: (message.headers as Record<string, string>) ?? {},
    };

    // Best-effort CRM resolve (existing contacts only) before rules/triage.
    const crmMatch = await resolveAndLinkThreadContact(client, {
      workspaceId: params.workspaceId,
      threadId: params.threadId,
      fromAddress: input.fromAddress,
    }).catch(() => null);

    let result = triageWithRules(input);

    // Cheap generative path only when rules leave triage ambiguous.
    const classified = await maybeClassifyWithModel({
      workspaceId: params.workspaceId,
      input,
      prior: result,
      bodyCharLimit: Number(mailbox?.max_classifier_body_chars ?? 8000),
    });
    if (classified) result = classified;

    const { data: thread } = await client
      .from("email_threads")
      .select("assigned_employee_id, assignment_source, steward_meta")
      .eq("id", params.threadId)
      .maybeSingle();

    const humanLocked = thread?.assignment_source === "human";

    // User mailbox rules (before assignment decision; never overwrite human lock).
    const ruleEffects = await applyMailboxRules(client, {
      workspaceId: params.workspaceId,
      mailboxId: params.mailboxId,
      threadId: params.threadId,
      fromAddress: input.fromAddress,
      subject: input.subject,
      hasAttachments: input.hasAttachments,
      category: result.category,
      humanAssignmentLocked: humanLocked,
    }).catch(() => null);
    if (ruleEffects?.priority) {
      result = { ...result, priority: ruleEffects.priority };
    }
    const employees = await loadEligibleEmployees(client, params.workspaceId);
    const assignment = decideAssignment({
      triage: result,
      existingEmployeeId: (thread?.assigned_employee_id as string) ?? null,
      employees,
      assignThreshold: Number(mailbox?.assign_threshold ?? 0.9),
    });

    result = {
      ...result,
      suggestedEmployeeId: humanLocked
        ? ((thread?.assigned_employee_id as string) ?? assignment.suggestedEmployeeId)
        : assignment.suggestedEmployeeId,
      assignmentConfidence: humanLocked
        ? 1
        : assignment.assignmentConfidence,
    };

    const priorMeta = (thread?.steward_meta as Record<string, unknown>) ?? {};
    const stewardMeta = {
      ...priorMeta,
      keyPoints: result.keyPoints,
      suggestedNextAction: result.suggestedNextAction,
      summary: result.summary ?? null,
      automationType: result.automationType ?? null,
      safetyFlags: result.safetyFlags,
      matchReason: humanLocked
        ? "Human assignment locked"
        : (assignment.matchReason ?? null),
      source: result.source,
      dismissedSuggestionFingerprint: priorMeta.dismissedSuggestionFingerprint ?? null,
      crmMatch: crmMatch?.contact
        ? {
            contactId: crmMatch.contact.id,
            fullName: crmMatch.contact.fullName,
            email: crmMatch.contact.email,
            autoLinked: crmMatch.linked,
          }
        : crmMatch?.suggestedEmail
          ? { suggestedEmail: crmMatch.suggestedEmail }
          : (priorMeta.crmMatch ?? null),
      matchedRuleIds: ruleEffects?.matchedRuleIds ?? [],
    };

    const patch: Record<string, unknown> = {
      triage_status: "ready",
      category: result.category,
      priority: result.priority,
      reply_required: result.replyRequired,
      triage_confidence: result.confidence,
      triage_version: TRIAGE_VERSION,
      last_triaged_at: new Date().toISOString(),
      triage_error_code: null,
      triage_error_at: null,
      steward_meta: stewardMeta,
    };

    if (!humanLocked) {
      patch.suggested_employee_id = assignment.suggestedEmployeeId ?? null;
      patch.assignment_confidence = assignment.assignmentConfidence;
      patch.assignment_source = assignment.assignmentSource ?? null;
      if (assignment.assignedEmployeeId) {
        patch.assigned_employee_id = assignment.assignedEmployeeId;
        // Invariant: assignment never starts a draft model / draft_status change.
      }
    }

    const { error: patchError } = await client
      .from("email_threads")
      .update(patch)
      .eq("id", params.threadId);
    if (patchError) throw patchError;

    await recordEmailEvent(client, {
      workspaceId: params.workspaceId,
      mailboxId: params.mailboxId,
      threadId: params.threadId,
      messageId: params.messageId,
      actorType: "system",
      eventType: "email.triaged",
      payload: {
        category: result.category,
        priority: result.priority,
        replyRequired: result.replyRequired,
        confidence: result.confidence,
        assignmentConfidence: result.assignmentConfidence,
        assignmentSource: assignment.assignmentSource ?? null,
        source: result.source,
        triageVersion: TRIAGE_VERSION,
      },
    });

    if (
      !humanLocked &&
      assignment.assignedEmployeeId &&
      assignment.assignmentSource !== "thread_continuity"
    ) {
      await recordEmailEvent(client, {
        workspaceId: params.workspaceId,
        mailboxId: params.mailboxId,
        threadId: params.threadId,
        messageId: params.messageId,
        actorType: "system",
        eventType: "email.assigned",
        payload: {
          employeeId: assignment.assignedEmployeeId,
          source: assignment.assignmentSource,
          confidence: assignment.assignmentConfidence,
        },
      });
    }

    // Ledger: triage is platform overhead (embeddings/classifier later). Rules-only ≈ $0.
    await recordShadowWorkMinutes(client, {
      workspaceId: params.workspaceId,
      employeeId: assignment.assignedEmployeeId ?? null,
      sourceType: "email_triage",
      sourceId: params.messageId,
      capability: "inbox_triage",
      workType: "email_triage",
      estimatedCostUsd: result.source === "classifier" ? 0.001 : 0,
      metadata: {
        platform_overhead: true,
        triageVersion: TRIAGE_VERSION,
        source: result.source,
        jobId: params.jobId ?? null,
      },
    }).catch(() => {});

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await client
      .from("email_threads")
      .update({
        triage_status: "failed",
        triage_error_code: "triage_failed",
        triage_error_at: new Date().toISOString(),
      })
      .eq("id", params.threadId);
    throw new Error(message);
  }
}

export async function enqueueTriageAfterInbound(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    mailboxId: string;
    threadId: string;
    messageId: string;
  },
): Promise<{ jobId: string | null }> {
  const { data: mailbox } = await client
    .from("workspace_mailboxes")
    .select("assistance_mode, max_triage_per_minute, max_concurrent_jobs")
    .eq("id", params.mailboxId)
    .maybeSingle();

  const mode = String(mailbox?.assistance_mode ?? "manual");
  if (mode === "manual" || mode === "ai_auto_draft") {
    // ai_auto_draft is Slice G; treat unknown/manual as skip. Organise modes proceed.
  }
  if (mode === "manual") {
    return { jobId: null };
  }
  if (mode !== "ai_triage" && mode !== "ai_triage_suggested_replies") {
    return { jobId: null };
  }

  const { countRecentJobs, countConcurrentJobs, enqueueEmailJob } = await import("./jobs");
  const since = new Date(Date.now() - 60_000).toISOString();
  const recent = await countRecentJobs(client, {
    mailboxId: params.mailboxId,
    jobType: "triage",
    sinceIso: since,
  });
  const concurrent = await countConcurrentJobs(client, params.workspaceId);
  // Rate / concurrency pressure → still enqueue, but delay availability for cron.
  const delayed =
    recent >= Number(mailbox?.max_triage_per_minute ?? 60) ||
    concurrent >= Number(mailbox?.max_concurrent_jobs ?? 20);
  const availableAt = delayed
    ? new Date(Date.now() + 60_000).toISOString()
    : new Date().toISOString();

  await client
    .from("email_threads")
    .update({ triage_status: "queued" })
    .eq("id", params.threadId);

  const { jobId } = await enqueueEmailJob(client, {
    workspaceId: params.workspaceId,
    mailboxId: params.mailboxId,
    threadId: params.threadId,
    messageId: params.messageId,
    jobType: "triage",
    idempotencyKey: `email-triage:${params.messageId}:${TRIAGE_VERSION}`,
    availableAt,
  });

  return { jobId };
}

/** Mark AI drafts stale when a newer inbound arrives. */
export async function markDraftsStaleOnInbound(
  client: SupabaseClient,
  params: { threadId: string; newMessageId: string },
): Promise<void> {
  await client
    .from("email_drafts")
    .update({
      is_stale: true,
      stale_reason: "Outdated — a newer email arrived after this draft was created.",
    })
    .eq("thread_id", params.threadId)
    .eq("origin_type", "ai_employee")
    .in("status", ["draft", "pending_approval", "approved"]);

  // Invalidate pending approvals on the thread.
  const { data: drafts } = await client
    .from("email_drafts")
    .select("id")
    .eq("thread_id", params.threadId);
  const draftIds = (drafts ?? []).map((d) => String(d.id));
  if (draftIds.length > 0) {
    await client
      .from("email_approvals")
      .update({ status: "invalidated" })
      .in("draft_id", draftIds)
      .eq("status", "pending");
  }

  await client
    .from("email_threads")
    .update({ latest_valid_approval_id: null })
    .eq("id", params.threadId);
}
