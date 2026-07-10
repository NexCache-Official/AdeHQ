import type {
  FastPathDecision,
  ThinkingBudget,
  WorkMode,
} from "./intelligence-context";

const MODE_POINTS: Record<WorkMode, number> = {
  fast: 1,
  balanced: 3,
  deep: 5,
  research: 7,
  collaboration: 6,
};

const FAST_PATH_POINTS: Record<FastPathDecision, number> = {
  greeting: 0,
  instant_answer: 0,
  direct: 3,
  obvious_search: 2,
  obvious_browser_research: 10,
  clarify: 0,
  needs_router: 3,
};

export function assignThinkingBudget(input: {
  fastPath: FastPathDecision;
  workMode?: WorkMode;
}): ThinkingBudget {
  const assigned = input.workMode
    ? MODE_POINTS[input.workMode]
    : FAST_PATH_POINTS[input.fastPath];

  return {
    assigned,
    consumed: 0,
    maxSearches: assigned >= 7 ? 4 : assigned >= 3 ? 2 : assigned >= 1 ? 1 : 0,
    maxEmployeeCalls: assigned >= 6 ? 3 : assigned >= 3 ? 1 : 0,
    maxRouterCalls: input.fastPath === "needs_router" && assigned > 0 ? 1 : 0,
    allowBrowser: assigned >= 8,
    allowCollaboration:
      input.workMode === "collaboration" || assigned >= 6,
  };
}

export function canSpendBudget(
  budget: ThinkingBudget,
  points: number,
): boolean {
  return budget.consumed + points <= budget.assigned;
}

export function spendBudget(
  budget: ThinkingBudget,
  points: number,
): ThinkingBudget {
  return {
    ...budget,
    consumed: Math.min(budget.assigned, budget.consumed + Math.max(0, points)),
  };
}
