import {
  BROWSER_ACCESS_LABELS,
  normalizeBrowserAccess,
  resolveEmployeeIntelligencePolicy,
  type BrowserAccess,
} from "@/lib/ai/intelligence-policy";
import type { AIEmployee } from "@/lib/types";

export class BrowserResearchPermissionError extends Error {
  readonly code = "browser_research_forbidden";

  constructor(message: string) {
    super(message);
    this.name = "BrowserResearchPermissionError";
  }
}

export function getEmployeeBrowserAccess(
  employee: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">,
): BrowserAccess {
  return normalizeBrowserAccess(resolveEmployeeIntelligencePolicy(employee).browserAccess);
}

export function canEmployeeUseBrowserResearch(
  employee: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">,
): boolean {
  return getEmployeeBrowserAccess(employee) !== "none";
}

export function getBrowserResearchAccessLabel(
  employee: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">,
): string {
  const access = getEmployeeBrowserAccess(employee);
  if (access === "full_later") {
    return `${BROWSER_ACCESS_LABELS.full_later} — future full access`;
  }
  return BROWSER_ACCESS_LABELS[access];
}

export function assertBrowserResearchAllowed(
  employee: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">,
): void {
  if (!canEmployeeUseBrowserResearch(employee)) {
    throw new BrowserResearchPermissionError(
      "Browser research is not enabled for this employee.",
    );
  }
}
