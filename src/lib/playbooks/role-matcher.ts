import type {
  PlaybookRoleAssignment,
  PlaybookRoleCandidate,
  PlaybookRoleRequirement,
} from "./contracts";

function tagOverlap(required: string[] | undefined, have: string[]): string[] {
  if (!required?.length) return [];
  const haveSet = new Set(have.map((t) => t.toLowerCase()));
  return required.filter((t) => haveSet.has(t.toLowerCase()));
}

function scoreCandidate(
  requirement: PlaybookRoleRequirement,
  candidate: PlaybookRoleCandidate,
): { score: number; matchedTags: string[] } {
  const cap = tagOverlap(requirement.capabilityTags, candidate.capabilityTags);
  const role = tagOverlap(requirement.roleTags, candidate.roleTags);
  const matchedTags = [...new Set([...cap, ...role])];

  let score = cap.length * 2 + role.length * 3;

  // Soft preference: exact roleKey tag match
  if (candidate.roleTags.some((t) => t.toLowerCase() === requirement.roleKey.toLowerCase())) {
    score += 5;
  }

  // Prefer lighter workload when provided
  if (typeof candidate.workload === "number") {
    score -= Math.min(3, Math.max(0, candidate.workload) * 0.5);
  }

  // If requirement specifies tags and none match, score stays low (but still assignable)
  if (
    (requirement.capabilityTags?.length || requirement.roleTags?.length) &&
    matchedTags.length === 0
  ) {
    score = Math.min(score, 0.1);
  }

  return { score, matchedTags };
}

/**
 * Bind playbook role requirements to concrete employees.
 * Never invents employees — only assigns from the provided candidate list.
 */
export function matchPlaybookRoles(
  requirements: PlaybookRoleRequirement[],
  candidates: PlaybookRoleCandidate[],
): PlaybookRoleAssignment[] {
  const assignments: PlaybookRoleAssignment[] = [];
  const used = new Set<string>();

  for (const requirement of requirements) {
    const minCount = Math.max(1, requirement.minCount ?? 1);
    const maxCount = Math.max(minCount, requirement.maxCount ?? minCount);

    const ranked = candidates
      .filter((c) => !used.has(c.employeeId))
      .map((c) => {
        const { score, matchedTags } = scoreCandidate(requirement, c);
        return { candidate: c, score, matchedTags };
      })
      .sort((a, b) => b.score - a.score);

    let assigned = 0;
    for (const row of ranked) {
      if (assigned >= maxCount) break;
      // Never invent — only real candidates
      if (!row.candidate.employeeId) continue;
      assignments.push({
        roleKey: requirement.roleKey,
        employeeId: row.candidate.employeeId,
        score: Number(row.score.toFixed(3)),
        matchedTags: row.matchedTags,
      });
      used.add(row.candidate.employeeId);
      assigned += 1;
    }

    // Leave gaps if not enough candidates — caller decides whether to fail closed
    if (assigned < minCount) {
      // no invented employees
    }
  }

  return assignments;
}
