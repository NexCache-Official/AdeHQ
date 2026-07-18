import { MAYA_EMPLOYEE_ID, MAYA_SYSTEM_EMPLOYEE_KEY } from "@/lib/hiring/maya";

/** Hiring journey work types owned by Maya — never bill WH to the workspace. */
const MAYA_HIRING_WORK_TYPES = new Set(["hiring_recruiter", "hiring_candidates"]);

/**
 * Maya (workforce guide) and her hiring journey are free for customers.
 * Platform still records COGS on the cost ledger / usage events.
 */
export function isMayaBillableExempt(params: {
  employeeId?: string | null;
  workType?: string | null;
  systemEmployeeKey?: string | null;
}): boolean {
  if (params.employeeId === MAYA_EMPLOYEE_ID) return true;
  if (params.systemEmployeeKey === MAYA_SYSTEM_EMPLOYEE_KEY) return true;
  if (params.systemEmployeeKey === "maya") return true;
  const wt = (params.workType ?? "").trim().toLowerCase();
  if (MAYA_HIRING_WORK_TYPES.has(wt)) return true;
  return false;
}

export function isMayaEmployeeId(employeeId: string | null | undefined): boolean {
  return employeeId === MAYA_EMPLOYEE_ID;
}

export function isMayaHiringWorkType(workType: string | null | undefined): boolean {
  return MAYA_HIRING_WORK_TYPES.has((workType ?? "").trim().toLowerCase());
}
