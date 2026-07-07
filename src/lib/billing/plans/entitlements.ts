import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWorkspacePlan } from "./resolve-workspace-plan";

/**
 * Effective feature access for a workspace, derived from its resolved commercial plan.
 * This is the single source of truth for gating paid features (browser research, gateway
 * search, etc.) so plan changes reflect across the workspace without per-call plan reads.
 */
export type WorkspaceFeatureAccess = {
  planSlug: string;
  browserResearchEnabled: boolean;
  gatewaySearchEnabled: boolean;
  customAiEmployeesEnabled: boolean;
  teamFeaturesEnabled: boolean;
  adminControlsEnabled: boolean;
  prioritySupport: boolean;
  allowedIntelligenceTiers: string[];
  maxBrowserRunsPerWeek: number | null;
  maxRooms: number | null;
  maxTopics: number | null;
};

/**
 * Thrown when a workspace's plan does not include a requested feature.
 * status 402 (Payment Required) signals the client to prompt an upgrade.
 */
export class PlanEntitlementError extends Error {
  readonly code = "plan_entitlement_denied";
  readonly status = 402;
  readonly feature: string;

  constructor(feature: string, message: string) {
    super(message);
    this.name = "PlanEntitlementError";
    this.feature = feature;
  }
}

export async function getWorkspaceFeatureAccess(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceFeatureAccess> {
  const plan = await resolveWorkspacePlan(client, workspaceId);
  const c = plan.config;
  return {
    planSlug: plan.planSlug,
    browserResearchEnabled: Boolean(c.browserResearchEnabled),
    gatewaySearchEnabled: Boolean(c.gatewaySearchEnabled),
    customAiEmployeesEnabled: Boolean(c.customAiEmployeesEnabled),
    teamFeaturesEnabled: Boolean(c.teamFeaturesEnabled),
    adminControlsEnabled: Boolean(c.adminControlsEnabled),
    prioritySupport: Boolean(c.prioritySupport),
    allowedIntelligenceTiers: c.allowedIntelligenceTiers ?? [],
    maxBrowserRunsPerWeek: c.maxBrowserRunsPerWeek,
    maxRooms: c.maxRooms,
    maxTopics: c.maxTopics,
  };
}

/**
 * Assert that a workspace's plan includes browser research; throws PlanEntitlementError otherwise.
 * Fails open on lookup errors so a transient plan-read failure never blocks a paid feature.
 */
export async function assertBrowserResearchPlanAccess(
  client: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  let access: WorkspaceFeatureAccess;
  try {
    access = await getWorkspaceFeatureAccess(client, workspaceId);
  } catch {
    return;
  }
  if (!access.browserResearchEnabled) {
    throw new PlanEntitlementError(
      "browser_research",
      "Live browser research isn't included in your current plan. Upgrade to enable it.",
    );
  }
}

/**
 * Assert that a workspace's plan includes gateway web search; throws PlanEntitlementError otherwise.
 * Fails open on lookup errors.
 */
export async function assertGatewaySearchPlanAccess(
  client: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  let access: WorkspaceFeatureAccess;
  try {
    access = await getWorkspaceFeatureAccess(client, workspaceId);
  } catch {
    return;
  }
  if (!access.gatewaySearchEnabled) {
    throw new PlanEntitlementError(
      "gateway_search",
      "Web search isn't included in your current plan. Upgrade to enable it.",
    );
  }
}
