export type LeadCandidate = {
  id: string;
  name: string;
  role?: string | null;
  roleKey?: string | null;
};

export type SelectLeadInput = {
  message: string;
  candidates: LeadCandidate[];
  /** Prefer these (e.g. @mentions in order). */
  preferredEmployeeIds?: string[];
  /** Room steward / orchestration already picked these. */
  orchestrationSelectedIds?: string[];
  /** DM peer employee when in a private AI DM. */
  dmEmployeeId?: string | null;
  isPrivateDm?: boolean;
};

/**
 * Pick one lead who owns user communication and final synthesis.
 * Prefer: explicit mention order → orchestration selection → role fit → first accessible.
 */
export function selectLeadEmployee(input: SelectLeadInput): LeadCandidate | null {
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  if (!input.candidates.length) return null;

  if (input.isPrivateDm && input.dmEmployeeId) {
    return byId.get(input.dmEmployeeId) ?? input.candidates[0];
  }

  for (const id of input.preferredEmployeeIds ?? []) {
    const hit = byId.get(id);
    if (hit) return hit;
  }

  for (const id of input.orchestrationSelectedIds ?? []) {
    const hit = byId.get(id);
    if (hit) return hit;
  }

  const text = input.message.toLowerCase();
  const roleHints: Array<{ re: RegExp; keys: string[] }> = [
    { re: /\b(code|bug|refactor|api|engineer)\b/, keys: ["engineer", "developer", "coder", "cto"] },
    { re: /\b(market|research|competitor|analyst)\b/, keys: ["analyst", "research", "strategy"] },
    { re: /\b(sales|outreach|pipeline|crm)\b/, keys: ["sales", "sdr", "account"] },
    { re: /\b(design|brand|visual|ui)\b/, keys: ["design", "designer", "creative"] },
    { re: /\b(legal|compliance|contract)\b/, keys: ["legal", "counsel", "compliance"] },
    { re: /\b(finance|budget|pricing|unit economics)\b/, keys: ["finance", "cfo", "ops"] },
  ];

  for (const hint of roleHints) {
    if (!hint.re.test(text)) continue;
    const match = input.candidates.find((c) => {
      const blob = `${c.roleKey ?? ""} ${c.role ?? ""} ${c.name}`.toLowerCase();
      return hint.keys.some((k) => blob.includes(k));
    });
    if (match) return match;
  }

  return input.candidates[0];
}

/**
 * Pick specialists excluding the lead, capped by policy.
 */
export function selectCollaborators(
  candidates: LeadCandidate[],
  leadId: string,
  preferredEmployeeIds: string[] | undefined,
  maxCollaborators: number,
): LeadCandidate[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out: LeadCandidate[] = [];
  const seen = new Set<string>([leadId]);

  for (const id of preferredEmployeeIds ?? []) {
    if (seen.has(id)) continue;
    const hit = byId.get(id);
    if (!hit) continue;
    out.push(hit);
    seen.add(id);
    if (out.length >= maxCollaborators - 1) return out;
  }

  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    out.push(c);
    seen.add(c.id);
    if (out.length >= maxCollaborators - 1) break;
  }

  return out;
}
