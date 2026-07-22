// ===========================================================================
// Safe JsonLogic wrapper for Workforce Studio composition rules.
//
// Template manifests are authored in-repo today (trusted), but composition
// rules are still validated against an explicit allowlist before evaluation
// so a future user-editable rule surface (or a bad template edit) can never
// reach the filesystem, network, or arbitrary JS. Rules are pure functions
// over the intake-answers JSON — no side effects, ever.
// ===========================================================================

import jsonLogic from "json-logic-js";

export type JsonLogicRule = unknown;

let customOperationsRegistered = false;

/** Operators intake/composition rules are allowed to use. Anything outside
 * this list fails validation before evaluation ever runs. */
const ALLOWED_OPERATORS = new Set([
  "var",
  "missing",
  "missing_some",
  "if",
  "==",
  "===",
  "!=",
  "!==",
  "!",
  "!!",
  "and",
  "or",
  "<",
  "<=",
  ">",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "min",
  "max",
  "map",
  "filter",
  "reduce",
  "all",
  "none",
  "some",
  "merge",
  "in",
  "cat",
  "substr",
  // Workforce Studio custom operators (registered below).
  "countSeatsWithRole",
  "hasAnswer",
  "answerAtLeast",
]);

function registerCustomOperations() {
  if (customOperationsRegistered) return;
  customOperationsRegistered = true;

  // countSeatsWithRole(seatsArray, roleKey) — used by scaling rules to decide
  // "add a 2nd backend engineer once >1 frontend engineer exists" etc.
  jsonLogic.add_operation(
    "countSeatsWithRole",
    (seats: unknown, roleKey: unknown) =>
      Array.isArray(seats)
        ? seats.filter((s) => (s as { roleKey?: unknown })?.roleKey === roleKey).length
        : 0,
  );

  // hasAnswer(answers, key) — true when an intake answer key is present and truthy.
  jsonLogic.add_operation("hasAnswer", (answers: unknown, key: unknown) => {
    if (!answers || typeof answers !== "object") return false;
    const value = (answers as Record<string, unknown>)[String(key)];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });

  // answerAtLeast(answers, key, threshold) — numeric comparison guard for
  // scaling rules keyed off e.g. "expected monthly ticket volume".
  jsonLogic.add_operation("answerAtLeast", (answers: unknown, key: unknown, threshold: unknown) => {
    if (!answers || typeof answers !== "object") return false;
    const value = Number((answers as Record<string, unknown>)[String(key)]);
    return Number.isFinite(value) && value >= Number(threshold);
  });
}

registerCustomOperations();

export class UnsafeJsonLogicRuleError extends Error {
  constructor(operator: string) {
    super(`JsonLogic operator "${operator}" is not in the Workforce Studio allowlist.`);
    this.name = "UnsafeJsonLogicRuleError";
  }
}

/** Recursively walk a rule tree and throw on any operator outside the
 * allowlist. Call this once at template-publish time and again defensively
 * before every evaluation. */
export function assertSafeRule(rule: JsonLogicRule): void {
  if (Array.isArray(rule)) {
    for (const item of rule) assertSafeRule(item);
    return;
  }
  if (rule && typeof rule === "object") {
    for (const [operator, args] of Object.entries(rule as Record<string, unknown>)) {
      if (!ALLOWED_OPERATORS.has(operator)) {
        throw new UnsafeJsonLogicRuleError(operator);
      }
      assertSafeRule(args);
    }
  }
}

/** Evaluate a validated composition rule against data (intake answers plus
 * whatever partial draft state the rule needs to see, e.g. current seats). */
export function evaluateRule<T = unknown>(rule: JsonLogicRule, data: Record<string, unknown>): T {
  assertSafeRule(rule);
  return jsonLogic.apply(rule as never, data) as T;
}

/** Convenience boolean evaluator for gating conditions ("add this module
 * when..."). Non-boolean truthy/falsy results are coerced. */
export function evaluateCondition(rule: JsonLogicRule, data: Record<string, unknown>): boolean {
  return Boolean(evaluateRule(rule, data));
}
