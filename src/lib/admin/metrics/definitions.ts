import type { AdminPrivacyLevel } from "../privacy";

export type AdminMetricDefinition = {
  key: string;
  label: string;
  description: string;
  sourceTables: string[];
  calculation: string;
  privacyLevel: AdminPrivacyLevel;
};

/** Central metric definitions — dashboards should reference these keys. */
export const ADMIN_METRIC_DEFINITIONS: Record<string, AdminMetricDefinition> = {
  new_signups: {
    key: "new_signups",
    label: "New signups",
    description: "Profiles created in the selected time range.",
    sourceTables: ["profiles"],
    calculation: "COUNT(profiles) WHERE created_at >= range_start",
    privacyLevel: "internal_metadata",
  },
  active_workspaces: {
    key: "active_workspaces",
    label: "Active workspaces",
    description: "Workspaces with at least one AI usage event in range.",
    sourceTables: ["ai_usage_events", "workspaces"],
    calculation: "COUNT(DISTINCT workspace_id) FROM ai_usage_events in range",
    privacyLevel: "public_operational",
  },
  ai_cost: {
    key: "ai_cost",
    label: "AI cost",
    description: "Sum of coalesce(actual_cost_usd, estimated_cost_usd) from usage events.",
    sourceTables: ["ai_usage_events"],
    calculation: "SUM(COALESCE(actual_cost_usd, estimated_cost_usd))",
    privacyLevel: "public_operational",
  },
  work_hours_used: {
    key: "work_hours_used",
    label: "Work Hours (shadow)",
    description: "Sum of work_minutes_estimated from shadow ledger, converted to hours.",
    sourceTables: ["ai_work_minutes_ledger"],
    calculation: "SUM(work_minutes_estimated) / 60",
    privacyLevel: "public_operational",
  },
  browser_runs: {
    key: "browser_runs",
    label: "Browser research runs",
    description: "Count of browser_research_runs in range (metadata only).",
    sourceTables: ["browser_research_runs"],
    calculation: "COUNT(browser_research_runs) WHERE created_at >= range_start",
    privacyLevel: "public_operational",
  },
  failed_ai_runs: {
    key: "failed_ai_runs",
    label: "Failed AI runs",
    description: "Usage events with status failed or blocked.",
    sourceTables: ["ai_usage_events"],
    calculation: "COUNT WHERE status IN ('failed', 'blocked')",
    privacyLevel: "public_operational",
  },
  activation_rate: {
    key: "activation_rate",
    label: "Onboarding completion",
    description: "Share of cohort workspaces with onboarding_complete = true.",
    sourceTables: ["workspaces"],
    calculation: "completed / total in cohort",
    privacyLevel: "internal_metadata",
  },
  time_to_first_employee: {
    key: "time_to_first_employee",
    label: "Time to first employee",
    description: "Median hours from workspace creation to first non-system ai_employee.",
    sourceTables: ["workspaces", "ai_employees"],
    calculation: "MEDIAN(first_employee_at - workspace.created_at)",
    privacyLevel: "internal_metadata",
  },
  time_to_first_artifact: {
    key: "time_to_first_artifact",
    label: "Time to first artifact",
    description: "Median hours from workspace creation to first artifact.",
    sourceTables: ["workspaces", "artifacts"],
    calculation: "MEDIAN(first_artifact_at - workspace.created_at)",
    privacyLevel: "internal_metadata",
  },
};

export function getMetricDefinition(key: string): AdminMetricDefinition | undefined {
  return ADMIN_METRIC_DEFINITIONS[key];
}
