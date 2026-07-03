import type { EmployeeRoleKey } from "@/lib/types";

export type ParticipantEmployee = {
  id: string;
  name: string;
  roleKey?: EmployeeRoleKey;
};

export type ParticipantRefKind =
  | "passive_reference"
  | "observe_only"
  | "direct_question"
  | "task_assignment"
  | "handoff"
  | "collaboration_request"
  | "correction_or_instruction";

export type ResolvedParticipantReference = {
  employeeId: string;
  employeeName: string;
  kind: ParticipantRefKind;
  matchedText: string;
  index: number;
};

export type ParticipantReferenceResult = {
  references: ResolvedParticipantReference[];
  actionableEmployeeIds: string[];
  observeOnlyEmployeeIds: string[];
};

const ACTIONABLE_KINDS = new Set<ParticipantRefKind>([
  "direct_question",
  "task_assignment",
  "handoff",
  "collaboration_request",
]);

const PASSIVE_PATTERNS = [
  /\bdid (good|great|well|nice)\b/i,
  /\bearlier\b/i,
  /\byesterday\b/i,
  /\blast (week|time|message)\b/i,
  /\bthanks?\b/i,
  /\bthank you\b/i,
  /'s\s+(research|work|analysis|report|findings|input|notes)\b/i,
  /\bfrom\s+\w+\s+'s\b/i,
];

const OBSERVE_PATTERNS = [
  /\bshould wait\b/i,
  /\bwait for\b/i,
  /\bonce\s+.+\s+has\b/i,
  /\bafter\s+.+\s+(has|finishes|completes|is done)\b/i,
  /\bwhen\s+.+\s+has\b/i,
  /\blet\s+.+\s+(finish|complete|handle)\b/i,
];

const TASK_ASSIGNMENT_PATTERNS = [
  /\bcan you own\b/i,
  /\bcould you own\b/i,
  /\bplease own\b/i,
  /\bshould own\b/i,
  /\btake (the|this|on)\b/i,
  /\bown the\b/i,
  /\bhandle the\b/i,
  /\bdo the\b/i,
  /\bwork on\b/i,
  /\blook into\b/i,
  /\breview this\b/i,
  /\bask\s+.+\s+to\b/i,
  /\bget\s+.+\s+to\b/i,
  /\bhave\s+.+\s+(own|handle|review|look|prepare|draft)\b/i,
  /—\s*can you\b/i,
  /,\s*can you\b/i,
];

const DIRECT_QUESTION_PATTERNS = [
  /\?\s*$/,
  /\bwhat do you think\b/i,
  /\bcan you\b/i,
  /\bcould you\b/i,
  /\bwould you\b/i,
  /\bwill you\b/i,
  /\bdo you\b/i,
  /\bhow (would|should|do) you\b/i,
];

const HANDOFF_PATTERNS = [
  /\bpass (this |it )?to\b/i,
  /\bhand (this |it )?off\b/i,
  /\bhand over to\b/i,
  /\btransfer to\b/i,
];

const COLLABORATION_PATTERNS = [
  /\bcoordinate\b/i,
  /\bcollaborate\b/i,
  /\bwork together\b/i,
  /\bteam up\b/i,
  /\bbetween (each other|yourselves|you)\b/i,
  /\band\s+.+\s+should\b/i,
];

const CORRECTION_PATTERNS = [
  /\bplease @\s*mention\b/i,
  /\buse @\s*mention\b/i,
  /\bwhen you (want|need) to talk\b/i,
  /\brepeat your last message\b/i,
];

const ROLE_ALIASES: Record<string, string[]> = {
  research: ["research", "researcher", "market research", "research employee", "research analyst"],
  sales: ["sales", "sdr", "sales rep", "sales development", "sales employee"],
  pm: ["product", "pm", "product manager", "product employee"],
  marketing: ["marketing", "marketing employee"],
  ops: ["ops", "operations"],
};

type NameCandidate = {
  employeeId: string;
  employeeName: string;
  pattern: RegExp;
  label: string;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildNameCandidates(employees: ParticipantEmployee[]): NameCandidate[] {
  const candidates: NameCandidate[] = [];
  const firstNameCounts = new Map<string, number>();

  for (const employee of employees) {
    const parts = employee.name.trim().split(/\s+/);
    const first = parts[0]?.toLowerCase();
    if (first) firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1);
  }

  for (const employee of employees) {
    const full = employee.name.trim();
    const parts = full.split(/\s+/);
    const first = parts[0];

    candidates.push({
      employeeId: employee.id,
      employeeName: full,
      label: full,
      pattern: new RegExp(`(?<!@)\\b${escapeRegex(full)}\\b`, "gi"),
    });

    if (first && (firstNameCounts.get(first.toLowerCase()) ?? 0) === 1) {
      candidates.push({
        employeeId: employee.id,
        employeeName: full,
        label: first,
        pattern: new RegExp(`(?<!@)\\b${escapeRegex(first)}\\b`, "gi"),
      });
    }

    const roleKey = employee.roleKey?.toLowerCase();
    const roleAliases = roleKey ? ROLE_ALIASES[roleKey] : undefined;
    if (roleAliases) {
      for (const alias of roleAliases) {
        candidates.push({
          employeeId: employee.id,
          employeeName: full,
          label: alias,
          pattern: new RegExp(`(?<!@)\\b${escapeRegex(alias)}\\b`, "gi"),
        });
      }
    }
  }

  return candidates.sort((a, b) => b.label.length - a.label.length);
}

function localContext(text: string, index: number, span: number): string {
  const start = Math.max(0, index - span);
  const end = Math.min(text.length, index + span);
  return text.slice(start, end);
}

function classifyReference(context: string, fullText: string): ParticipantRefKind {
  if (CORRECTION_PATTERNS.some((p) => p.test(fullText))) {
    return "correction_or_instruction";
  }
  if (COLLABORATION_PATTERNS.some((p) => p.test(fullText))) {
    return "collaboration_request";
  }
  if (HANDOFF_PATTERNS.some((p) => p.test(context))) {
    return "handoff";
  }
  if (OBSERVE_PATTERNS.some((p) => p.test(context))) {
    return "observe_only";
  }
  if (PASSIVE_PATTERNS.some((p) => p.test(context))) {
    return "passive_reference";
  }
  if (TASK_ASSIGNMENT_PATTERNS.some((p) => p.test(context))) {
    return "task_assignment";
  }
  if (DIRECT_QUESTION_PATTERNS.some((p) => p.test(context))) {
    return "direct_question";
  }
  return "passive_reference";
}

export function resolveParticipantReferences(
  messageText: string,
  employees: ParticipantEmployee[],
  options?: { excludeEmployeeIds?: string[] },
): ParticipantReferenceResult {
  const text = messageText.trim();
  if (!text || employees.length === 0) {
    return { references: [], actionableEmployeeIds: [], observeOnlyEmployeeIds: [] };
  }

  const exclude = new Set(options?.excludeEmployeeIds ?? []);
  const candidates = buildNameCandidates(employees);
  const hits: ResolvedParticipantReference[] = [];
  const seenAtIndex = new Set<string>();

  for (const candidate of candidates) {
    candidate.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = candidate.pattern.exec(text)) !== null) {
      const key = `${candidate.employeeId}:${match.index}`;
      if (seenAtIndex.has(key)) continue;
      seenAtIndex.add(key);

      const context = localContext(text, match.index, 80);
      const kind = classifyReference(context, text);

      hits.push({
        employeeId: candidate.employeeId,
        employeeName: candidate.employeeName,
        kind,
        matchedText: match[0],
        index: match.index,
      });
    }
  }

  hits.sort((a, b) => a.index - b.index);

  const references: ResolvedParticipantReference[] = [];
  const bestByEmployee = new Map<string, ResolvedParticipantReference>();

  for (const hit of hits) {
    if (exclude.has(hit.employeeId)) continue;
    const existing = bestByEmployee.get(hit.employeeId);
    if (!existing) {
      bestByEmployee.set(hit.employeeId, hit);
      continue;
    }
    const existingActionable = ACTIONABLE_KINDS.has(existing.kind);
    const hitActionable = ACTIONABLE_KINDS.has(hit.kind);
    if (hitActionable && !existingActionable) {
      bestByEmployee.set(hit.employeeId, hit);
    }
  }

  references.push(...bestByEmployee.values());
  references.sort((a, b) => a.index - b.index);

  const actionableEmployeeIds = references
    .filter((ref) => ACTIONABLE_KINDS.has(ref.kind))
    .map((ref) => ref.employeeId);

  const observeOnlyEmployeeIds = references
    .filter((ref) => ref.kind === "observe_only")
    .map((ref) => ref.employeeId);

  return {
    references,
    actionableEmployeeIds: [...new Set(actionableEmployeeIds)],
    observeOnlyEmployeeIds: [...new Set(observeOnlyEmployeeIds)],
  };
}

export function employeesFromReferenceIds<T extends ParticipantEmployee>(
  employees: T[],
  ids: string[],
): T[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const employee = byId.get(id);
    if (employee) {
      seen.add(id);
      ordered.push(employee);
    }
  }
  return ordered;
}

export function isMultiEmployeeCollaborationRequest(text: string): boolean {
  return COLLABORATION_PATTERNS.some((p) => p.test(text));
}
