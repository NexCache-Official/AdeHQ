import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PLAN_SLUG } from "./resolve-workspace-plan";

export type PlanTermSource = "signup" | "checkout" | "promo" | "override" | "admin";

export type StartPlanTermInput = {
  workspaceId: string;
  planSlug: string;
  source: PlanTermSource;
  actorUserId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  /** When false, skip if to_plan_slug equals current plan_slug (still ok to bump dates on paid checkout). */
  force?: boolean;
};

/**
 * Initialize free-plan term timestamps at workspace creation.
 * Sets free_plan_started_at once; also seeds current_plan_started_at.
 */
export async function initializeFreePlanTerm(
  client: SupabaseClient,
  workspaceId: string,
  actorUserId?: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing } = await client
    .from("workspaces")
    .select("plan_slug, free_plan_started_at, current_plan_started_at")
    .eq("id", workspaceId)
    .maybeSingle();

  const freeStarted = existing?.free_plan_started_at
    ? String(existing.free_plan_started_at)
    : now;

  await client
    .from("workspaces")
    .update({
      plan_slug: DEFAULT_PLAN_SLUG,
      plan: DEFAULT_PLAN_SLUG,
      free_plan_started_at: freeStarted,
      current_plan_started_at: existing?.current_plan_started_at
        ? String(existing.current_plan_started_at)
        : now,
    })
    .eq("id", workspaceId);

  await client.from("workspace_plan_events").insert({
    workspace_id: workspaceId,
    from_plan_slug: null,
    to_plan_slug: DEFAULT_PLAN_SLUG,
    source: "signup",
    actor_user_id: actorUserId ?? null,
    reason: "Workspace created on Free plan",
    started_at: freeStarted,
    metadata: {},
  });
}

/**
 * Start a new commercial plan term. Never mutates free_plan_started_at.
 * Updates plan_slug + current_plan_started_at and appends an audit event.
 */
export async function startPlanTerm(
  client: SupabaseClient,
  input: StartPlanTermInput,
): Promise<{ changed: boolean; startedAt: string }> {
  const planSlug = input.planSlug.trim().toLowerCase() || DEFAULT_PLAN_SLUG;
  const startedAt = new Date().toISOString();

  const { data: workspace, error } = await client
    .from("workspaces")
    .select("plan_slug, plan")
    .eq("id", input.workspaceId)
    .maybeSingle();
  if (error) throw error;

  const fromSlug =
    (workspace?.plan_slug as string | null) ??
    (workspace?.plan as string | null) ??
    null;

  if (!input.force && fromSlug && fromSlug.toLowerCase() === planSlug && input.source === "override") {
    return { changed: false, startedAt: startedAt };
  }

  const { error: updateError } = await client
    .from("workspaces")
    .update({
      plan_slug: planSlug,
      plan: planSlug,
      current_plan_started_at: startedAt,
    })
    .eq("id", input.workspaceId);
  if (updateError) throw updateError;

  const { error: eventError } = await client.from("workspace_plan_events").insert({
    workspace_id: input.workspaceId,
    from_plan_slug: fromSlug,
    to_plan_slug: planSlug,
    source: input.source,
    actor_user_id: input.actorUserId ?? null,
    reason: input.reason ?? null,
    started_at: startedAt,
    metadata: input.metadata ?? {},
  });
  if (eventError) throw eventError;

  return { changed: true, startedAt };
}
