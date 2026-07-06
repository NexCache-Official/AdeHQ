import type { SupabaseClient } from "@supabase/supabase-js";
import { AGGREGATION_ROW_LIMIT, countRows, daysAgoIso, type AdminRange, rangeStart } from "./helpers";

export type GrowthSummary = {
  range: AdminRange;
  signups: { today: number; week: number; month: number };
  onboardingCompletionRate: number;
  funnel: { stage: string; workspaces: number }[];
  timeToFirst: {
    employeeHours: number | null;
    aiReplyHours: number | null;
    artifactHours: number | null;
    browserRunHours: number | null;
  };
  retention: { d1: number | null; d7: number | null; d30: number | null };
  averages: { employeesPerWorkspace: number; roomsPerWorkspace: number };
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(value * 10) / 10;
}

function hoursBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / (60 * 60 * 1000);
}

export async function getGrowthSummary(
  client: SupabaseClient,
  range: AdminRange,
): Promise<GrowthSummary> {
  const since = rangeStart(range);

  const [
    signupsToday,
    signupsWeek,
    signupsMonth,
    workspacesRes,
    employeesRes,
    usageRes,
    artifactsRes,
    browserRes,
    roomsCount,
  ] = await Promise.all([
    countRows(client, "profiles", (q) => q.gte("created_at", daysAgoIso(1))),
    countRows(client, "profiles", (q) => q.gte("created_at", daysAgoIso(7))),
    countRows(client, "profiles", (q) => q.gte("created_at", daysAgoIso(30))),
    client
      .from("workspaces")
      .select("id, created_at, onboarding_complete, workspace_mode")
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("ai_employees")
      .select("workspace_id, created_at")
      .eq("is_system_employee", false)
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("ai_usage_events")
      .select("workspace_id, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("artifacts")
      .select("workspace_id, created_at")
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("browser_research_runs")
      .select("workspace_id, created_at")
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
    countRows(client, "rooms"),
  ]);

  for (const res of [workspacesRes, employeesRes, usageRes, artifactsRes, browserRes]) {
    if (res.error) throw res.error;
  }

  const workspaces = (workspacesRes.data ?? []).filter(
    (w) => w.workspace_mode !== "demo",
  );
  const workspaceCreatedAt = new Map(workspaces.map((w) => [w.id, w.created_at]));

  // First-milestone timestamp per workspace for each funnel stage.
  const firstOf = (rows: { workspace_id: string; created_at: string }[] | null) => {
    const map = new Map<string, string>();
    for (const row of rows ?? []) {
      const existing = map.get(row.workspace_id);
      if (!existing || row.created_at < existing) map.set(row.workspace_id, row.created_at);
    }
    return map;
  };

  const firstEmployee = firstOf(employeesRes.data);
  const firstUsage = firstOf(usageRes.data);
  const firstArtifact = firstOf(artifactsRes.data);
  const firstBrowser = firstOf(browserRes.data);

  const inCohort = (map: Map<string, string>) =>
    [...map.keys()].filter((id) => workspaceCreatedAt.has(id)).length;

  const funnel = [
    { stage: "Workspace created", workspaces: workspaces.length },
    {
      stage: "Onboarding complete",
      workspaces: workspaces.filter((w) => w.onboarding_complete).length,
    },
    { stage: "First AI employee hired", workspaces: inCohort(firstEmployee) },
    { stage: "First AI reply", workspaces: inCohort(firstUsage) },
    { stage: "First artifact created", workspaces: inCohort(firstArtifact) },
    { stage: "First browser research run", workspaces: inCohort(firstBrowser) },
  ];

  const timeTo = (milestones: Map<string, string>) => {
    const hours: number[] = [];
    for (const [workspaceId, at] of milestones) {
      const createdAt = workspaceCreatedAt.get(workspaceId);
      if (createdAt) hours.push(Math.max(0, hoursBetween(createdAt, at)));
    }
    return median(hours);
  };

  // Retention: workspaces (cohort) with any usage event N+ days after creation.
  const retentionFor = (days: number): number | null => {
    const cutoffMs = days * 24 * 60 * 60 * 1000;
    const eligible = workspaces.filter(
      (w) => Date.now() - new Date(w.created_at).getTime() >= cutoffMs,
    );
    if (eligible.length === 0) return null;
    const usageByWorkspace = new Map<string, string[]>();
    for (const row of usageRes.data ?? []) {
      const list = usageByWorkspace.get(row.workspace_id) ?? [];
      list.push(row.created_at);
      usageByWorkspace.set(row.workspace_id, list);
    }
    const retained = eligible.filter((w) => {
      const threshold = new Date(w.created_at).getTime() + cutoffMs;
      return (usageByWorkspace.get(w.id) ?? []).some(
        (at) => new Date(at).getTime() >= threshold,
      );
    });
    return Math.round((retained.length / eligible.length) * 100);
  };

  const totalWorkspaces = await countRows(client, "workspaces");
  const totalEmployees = await countRows(client, "ai_employees", (q) =>
    q.eq("is_system_employee", false),
  );

  return {
    range,
    signups: { today: signupsToday, week: signupsWeek, month: signupsMonth },
    onboardingCompletionRate:
      workspaces.length > 0
        ? Math.round(
            (workspaces.filter((w) => w.onboarding_complete).length / workspaces.length) * 100,
          )
        : 0,
    funnel,
    timeToFirst: {
      employeeHours: timeTo(firstEmployee),
      aiReplyHours: timeTo(firstUsage),
      artifactHours: timeTo(firstArtifact),
      browserRunHours: timeTo(firstBrowser),
    },
    retention: { d1: retentionFor(1), d7: retentionFor(7), d30: retentionFor(30) },
    averages: {
      employeesPerWorkspace:
        totalWorkspaces > 0 ? Math.round((totalEmployees / totalWorkspaces) * 10) / 10 : 0,
      roomsPerWorkspace:
        totalWorkspaces > 0 ? Math.round((roomsCount / totalWorkspaces) * 10) / 10 : 0,
    },
  };
}
