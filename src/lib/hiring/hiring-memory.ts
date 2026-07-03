import { MAYA_EMPLOYEE_ID } from "@/lib/hiring/maya";
import { buildMemoryDedupeKey } from "@/lib/memory/fingerprint";
import type { AiEmployeeApplicant, AiEmployeeJobBrief } from "@/lib/hiring/types";
import type { MemoryEntry } from "@/lib/types";
import { nowISO, uid } from "@/lib/utils";

export type HiringMemorySlot =
  | "role_summary"
  | "why_hired"
  | "core_responsibilities"
  | "approval_rules"
  | "work_style"
  | "initial_assignment";

const SLOT_ORDER: HiringMemorySlot[] = [
  "role_summary",
  "why_hired",
  "core_responsibilities",
  "approval_rules",
  "work_style",
  "initial_assignment",
];

export function hiringMemoryDedupeKey(
  workspaceId: string,
  sessionId: string | null | undefined,
  employeeId: string,
  slot: HiringMemorySlot,
): string {
  const sessionPart = sessionId?.trim() || `employee:${employeeId}`;
  return buildMemoryDedupeKey({
    workspaceId,
    title: slot,
    content: sessionPart,
    scope: "employee_profile",
    roomId: employeeId,
    suggestionKey: `hiring-session:${sessionPart}:${slot}`,
  });
}

function formatList(items: string[], emptyFallback: string): string {
  const lines = items.map((item) => item.trim()).filter(Boolean);
  if (!lines.length) return emptyFallback;
  return lines.map((line) => `• ${line}`).join("\n");
}

function buildSlotDraft(
  slot: HiringMemorySlot,
  input: {
    candidate: AiEmployeeApplicant;
    brief: AiEmployeeJobBrief;
    employeeId: string;
    employeeName: string;
    dmRoomId: string;
    sessionId?: string | null;
    userId: string;
    workspaceId: string;
  },
): Omit<MemoryEntry, "id" | "createdAt"> | null {
  const { candidate, brief, employeeId, employeeName, dmRoomId, sessionId, userId, workspaceId } =
    input;

  const baseMeta = {
    hiringSessionId: sessionId ?? null,
    candidateId: candidate.id,
    jobBriefId: sessionId ?? null,
    memorySlot: slot,
    source: "hiring_session" as const,
    dmEmployeeId: employeeId,
    scope: "employee_profile" as const,
  };

  const base = {
    roomId: dmRoomId,
    status: "approved" as const,
    createdByType: "human" as const,
    createdById: userId,
    scope: "employee_profile" as const,
    sourceType: "hiring_session" as const,
    sourceEmployeeId: employeeId,
    suggestedByType: "ai" as const,
    suggestedById: MAYA_EMPLOYEE_ID,
    savedByUserId: userId,
    tags: ["Hiring", employeeName.split(" ")[0] ?? employeeName, brief.roleTitle].filter(Boolean),
    metadata: baseMeta,
    dedupeKey: hiringMemoryDedupeKey(workspaceId, sessionId, employeeId, slot),
  };

  switch (slot) {
    case "role_summary": {
      const focus =
        brief.technicalFocus[0] ?? brief.businessFocus[0] ?? brief.domain ?? brief.department;
      const content = [
        `Role: ${brief.roleTitle}`,
        brief.department ? `Department: ${brief.department}` : null,
        focus ? `Focus: ${focus}` : null,
        brief.mission ? `Mission: ${brief.mission}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      if (!content.trim()) return null;
      return {
        ...base,
        type: "general",
        category: "People / Workforce",
        title: `${employeeName} — role summary`,
        content,
      };
    }
    case "why_hired": {
      const reason =
        candidate.whyThisCandidate?.trim() ||
        (candidate.recommended
          ? `Recommended fit for ${brief.roleTitle} based on the hiring brief.`
          : `Selected as ${candidate.title} for ${brief.roleTitle}.`);
      return {
        ...base,
        type: "decision",
        category: "Decision",
        title: `Why we hired ${employeeName}`,
        content: reason,
      };
    }
    case "core_responsibilities": {
      const body = formatList(
        brief.coreResponsibilities,
        "Core responsibilities will be refined in the employee DM.",
      );
      return {
        ...base,
        type: "instruction",
        category: "Process / Playbook",
        title: `${employeeName} — core responsibilities`,
        content: body,
      };
    }
    case "approval_rules": {
      const body = formatList(
        brief.approvalRules,
        "Ask before external-facing actions or high-risk changes.",
      );
      return {
        ...base,
        type: "instruction",
        category: "Process / Playbook",
        title: `${employeeName} — approval & safety rules`,
        content: body,
      };
    }
    case "work_style": {
      const parts = [
        brief.communicationStyle ? `Communication: ${brief.communicationStyle}` : null,
        brief.personalityTraits.length
          ? `Traits: ${brief.personalityTraits.join(", ")}`
          : null,
        brief.qualityPreference ? `Quality bias: ${brief.qualityPreference}` : null,
        brief.seniorityLevel ? `Seniority: ${brief.seniorityLevel}` : null,
        brief.autonomyLevel ? `Autonomy: ${brief.autonomyLevel}` : null,
        brief.proactivityLevel ? `Proactivity: ${brief.proactivityLevel}` : null,
      ].filter(Boolean);
      if (!parts.length) return null;
      return {
        ...base,
        type: "preference",
        category: "Preference",
        title: `${employeeName} — preferred work style`,
        content: parts.join("\n"),
      };
    }
    case "initial_assignment": {
      const starter =
        brief.coreResponsibilities[0] ??
        brief.mission ??
        `Help the team succeed as ${brief.roleTitle}.`;
      return {
        ...base,
        type: "instruction",
        category: "Process / Playbook",
        title: `${employeeName} — initial assignment`,
        content: `Open their DM and assign the first task.\n\nSuggested starting focus:\n• ${starter}`,
      };
    }
    default:
      return null;
  }
}

export type PersistHiringMemoriesParams = {
  workspaceId: string | null;
  userId?: string | null;
  sessionId?: string | null;
  candidate: AiEmployeeApplicant;
  brief: AiEmployeeJobBrief;
  employeeId: string;
  employeeName: string;
  dmRoomId: string;
  existingMemory?: MemoryEntry[];
  createMemory: (
    entry: Partial<MemoryEntry> & { title: string; content: string; roomId: string },
  ) => MemoryEntry;
};

/** Create employee-profile memories once per hiring session — deduped across DM/topic surfaces. */
export function persistHiringSessionMemories(params: PersistHiringMemoriesParams): MemoryEntry[] {
  const workspaceId = params.workspaceId?.trim();
  const userId = params.userId?.trim();
  if (!workspaceId || !userId) return [];

  const existingByKey = new Set(
    (params.existingMemory ?? [])
      .map((entry) => entry.dedupeKey)
      .filter((key): key is string => Boolean(key)),
  );

  const created: MemoryEntry[] = [];

  for (const slot of SLOT_ORDER) {
    const draft = buildSlotDraft(slot, {
      candidate: params.candidate,
      brief: params.brief,
      employeeId: params.employeeId,
      employeeName: params.employeeName,
      dmRoomId: params.dmRoomId,
      sessionId: params.sessionId,
      userId,
      workspaceId,
    });
    if (!draft) continue;
    if (draft.dedupeKey && existingByKey.has(draft.dedupeKey)) continue;

    const entry = params.createMemory({
      ...draft,
      id: uid("mem"),
      createdAt: nowISO(),
    });
    created.push(entry);
    if (entry.dedupeKey) existingByKey.add(entry.dedupeKey);
  }

  return created;
}
