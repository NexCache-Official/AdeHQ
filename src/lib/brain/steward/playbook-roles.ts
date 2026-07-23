/**
 * Steward-facing wrappers around playbook role matching.
 * Keeps Steward imports stable without pulling the full playbooks surface.
 */
export { matchPlaybookRoles } from "@/lib/playbooks/role-matcher";
export type {
  PlaybookRoleAssignment,
  PlaybookRoleCandidate,
  PlaybookRoleRequirement,
} from "@/lib/playbooks/contracts";

import { matchPlaybookRoles } from "@/lib/playbooks/role-matcher";
import type {
  PlaybookRoleAssignment,
  PlaybookRoleCandidate,
  PlaybookRoleRequirement,
} from "@/lib/playbooks/contracts";

/** Alias for Steward call sites. */
export function matchStewardPlaybookRoles(
  requirements: PlaybookRoleRequirement[],
  candidates: PlaybookRoleCandidate[],
): PlaybookRoleAssignment[] {
  return matchPlaybookRoles(requirements, candidates);
}
