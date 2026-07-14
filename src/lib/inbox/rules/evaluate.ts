/**
 * Simple deterministic mailbox rules (Slice E).
 * Evaluated before steward heuristics. Never sends email or creates rooms.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMayaEmployee, isWorkAssignableEmployee } from "@/lib/maya-employee";
import type { AIEmployee } from "@/lib/types";

export type RuleConditions = {
  from_domain?: string;
  from_address?: string;
  subject_contains?: string;
  has_attachment?: boolean;
  category_is?: string;
};

export type RuleActions = {
  add_label?: string; // label name
  set_priority?: "low" | "normal" | "high" | "urgent";
  assign_human?: string;
  assign_employee?: string;
  mark_spam?: boolean;
  set_status_waiting?: boolean;
};

export type EmailRuleRow = {
  id: string;
  name: string;
  priority: number;
  conditions: RuleConditions;
  actions: RuleActions;
};

export type RuleEvalInput = {
  fromAddress: string | null;
  subject: string;
  hasAttachments: boolean;
  category?: string | null;
};

export type RuleEvalEffects = {
  labelNames: string[];
  priority?: "low" | "normal" | "high" | "urgent";
  assignHumanId?: string;
  assignEmployeeId?: string;
  markSpam?: boolean;
  setStatusWaiting?: boolean;
  matchedRuleIds: string[];
};

function domainOf(email: string | null): string | null {
  if (!email) return null;
  const at = email.toLowerCase().indexOf("@");
  return at >= 0 ? email.toLowerCase().slice(at + 1) : null;
}

export function ruleMatches(rule: EmailRuleRow, input: RuleEvalInput): boolean {
  const c = rule.conditions ?? {};
  if (c.from_domain) {
    const dom = domainOf(input.fromAddress);
    if (!dom || dom !== c.from_domain.trim().toLowerCase()) return false;
  }
  if (c.from_address) {
    if ((input.fromAddress ?? "").toLowerCase() !== c.from_address.trim().toLowerCase()) {
      return false;
    }
  }
  if (c.subject_contains) {
    if (!input.subject.toLowerCase().includes(c.subject_contains.trim().toLowerCase())) {
      return false;
    }
  }
  if (typeof c.has_attachment === "boolean") {
    if (input.hasAttachments !== c.has_attachment) return false;
  }
  if (c.category_is) {
    if ((input.category ?? "").toLowerCase() !== c.category_is.trim().toLowerCase()) {
      return false;
    }
  }
  return true;
}

export async function loadActiveMailboxRules(
  client: SupabaseClient,
  params: { workspaceId: string; mailboxId: string },
): Promise<EmailRuleRow[]> {
  const { data, error } = await client
    .from("email_rules")
    .select("id, name, priority, conditions, actions, mailbox_id, is_active")
    .eq("workspace_id", params.workspaceId)
    .eq("is_active", true)
    .order("priority", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((row) => !row.mailbox_id || String(row.mailbox_id) === params.mailboxId)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      priority: Number(row.priority ?? 100),
      conditions: (row.conditions as RuleConditions) ?? {},
      actions: (row.actions as RuleActions) ?? {},
    }));
}

export function evaluateRules(
  rules: EmailRuleRow[],
  input: RuleEvalInput,
): RuleEvalEffects {
  const effects: RuleEvalEffects = {
    labelNames: [],
    matchedRuleIds: [],
  };
  for (const rule of rules) {
    if (!ruleMatches(rule, input)) continue;
    effects.matchedRuleIds.push(rule.id);
    const a = rule.actions ?? {};
    if (a.add_label?.trim()) effects.labelNames.push(a.add_label.trim());
    if (a.set_priority) effects.priority = a.set_priority;
    if (a.assign_human) effects.assignHumanId = a.assign_human;
    if (a.assign_employee) effects.assignEmployeeId = a.assign_employee;
    if (a.mark_spam) effects.markSpam = true;
    if (a.set_status_waiting) effects.setStatusWaiting = true;
  }
  return effects;
}

/** Apply matched rule effects to the thread (labels, priority, assign, spam). */
export async function applyMailboxRules(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    mailboxId: string;
    threadId: string;
    fromAddress: string | null;
    subject: string;
    hasAttachments: boolean;
    category?: string | null;
    /** Skip assignee overwrite when human locked. */
    humanAssignmentLocked?: boolean;
  },
): Promise<RuleEvalEffects> {
  const rules = await loadActiveMailboxRules(client, {
    workspaceId: params.workspaceId,
    mailboxId: params.mailboxId,
  });
  const effects = evaluateRules(rules, {
    fromAddress: params.fromAddress,
    subject: params.subject,
    hasAttachments: params.hasAttachments,
    category: params.category,
  });
  if (effects.matchedRuleIds.length === 0) return effects;

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (effects.priority) patch.priority = effects.priority;
  if (effects.markSpam) {
    patch.is_spam = true;
  }
  if (effects.setStatusWaiting) {
    patch.status = "waiting";
  }

  if (!params.humanAssignmentLocked) {
    if (effects.assignHumanId) {
      patch.assigned_human_id = effects.assignHumanId;
      patch.assigned_employee_id = null;
      patch.assignment_source = "deterministic_rule";
      patch.assignment_confidence = 1;
    } else if (effects.assignEmployeeId) {
      const { data: emp } = await client
        .from("ai_employees")
        .select("id, system_employee_key, is_system_employee, metadata")
        .eq("workspace_id", params.workspaceId)
        .eq("id", effects.assignEmployeeId)
        .maybeSingle();
      if (emp) {
        const stub = {
          id: String(emp.id),
          systemEmployeeKey: emp.system_employee_key
            ? String(emp.system_employee_key)
            : undefined,
          isSystemEmployee: Boolean(emp.is_system_employee),
          metadata: (emp.metadata as AIEmployee["metadata"]) ?? undefined,
        } as Pick<
          AIEmployee,
          "id" | "systemEmployeeKey" | "isSystemEmployee" | "metadata"
        >;
        if (!isMayaEmployee(stub) && isWorkAssignableEmployee(stub)) {
          patch.assigned_employee_id = effects.assignEmployeeId;
          patch.assigned_human_id = null;
          patch.suggested_employee_id = effects.assignEmployeeId;
          patch.assignment_source = "deterministic_rule";
          patch.assignment_confidence = 1;
        }
      }
    }
  }

  if (Object.keys(patch).length > 1) {
    const { error } = await client
      .from("email_threads")
      .update(patch)
      .eq("id", params.threadId)
      .eq("workspace_id", params.workspaceId);
    if (error) throw error;
  }

  for (const labelName of effects.labelNames) {
    const { data: label, error: labelErr } = await client
      .from("email_labels")
      .upsert(
        {
          workspace_id: params.workspaceId,
          name: labelName,
          color: null,
        },
        { onConflict: "workspace_id,name" },
      )
      .select("id")
      .maybeSingle();
    if (labelErr) throw labelErr;
    let labelId = label?.id ? String(label.id) : null;
    if (!labelId) {
      const { data: existing } = await client
        .from("email_labels")
        .select("id")
        .eq("workspace_id", params.workspaceId)
        .eq("name", labelName)
        .maybeSingle();
      labelId = existing?.id ? String(existing.id) : null;
    }
    if (labelId) {
      await client.from("email_thread_labels").upsert(
        {
          workspace_id: params.workspaceId,
          thread_id: params.threadId,
          label_id: labelId,
        },
        { onConflict: "thread_id,label_id" },
      );
    }
  }

  return effects;
}
