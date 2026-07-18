import type { SupabaseClient } from "@supabase/supabase-js";
import { MAYA_EMPLOYEE_ID, MAYA_SYSTEM_EMPLOYEE_KEY } from "@/lib/hiring/maya";
import { isMayaHiringWorkType } from "@/lib/billing/costing/maya-exempt";
import {
  AGGREGATION_ROW_LIMIT,
  effectiveCostUsd,
  rangeStart,
  sumBy,
  type AdminRange,
} from "./helpers";

export type UsageGroupBy =
  | "provider"
  | "model"
  | "workspace"
  | "employee"
  | "role"
  | "work_type"
  | "plan"
  | "day";

export type UsageCohort = "all" | "hired" | "maya";

export type UsageBreakdownRow = {
  key: string;
  label: string;
  subtitle?: string;
  costUsd: number;
  count: number;
  inputTokens: number;
  outputTokens: number;
  fallbackCount: number;
  failedCount: number;
};

export type UsageDayPoint = {
  day: string;
  costUsd: number;
  mayaCostUsd: number;
  hiredCostUsd: number;
  eventCount: number;
};

export type MayaUsagePanel = {
  costUsd: number;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  directChatCostUsd: number;
  hiringCostUsd: number;
  topWorkspaces: Array<{
    workspaceId: string;
    workspaceName: string;
    costUsd: number;
    eventCount: number;
    inputTokens: number;
    outputTokens: number;
  }>;
};

export type UsageSummary = {
  range: AdminRange;
  groupBy: UsageGroupBy;
  cohort: UsageCohort;
  totals: {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    eventCount: number;
    failedCount: number;
    blockedCount: number;
    fallbackCount: number;
    fallbackRate: number;
    workMinutes: number;
  };
  /** Always computed across the full range (ignores cohort filter). */
  cohortTotals: {
    allCostUsd: number;
    hiredCostUsd: number;
    mayaCostUsd: number;
    allEvents: number;
    hiredEvents: number;
    mayaEvents: number;
  };
  breakdown: UsageBreakdownRow[];
  daySeries: UsageDayPoint[];
  maya: MayaUsagePanel;
  failures: {
    provider: string;
    model: string;
    workspaceName: string;
    errorMessage: string | null;
    createdAt: string;
  }[];
};

type UsageEvent = {
  workspace_id: string;
  employee_id: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  fallback_used: boolean | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  error_message: string | null;
  created_at: string;
};

type EmployeeLookup = {
  id: string;
  name: string;
  role: string | null;
  role_key: string | null;
  system_employee_key: string | null;
  workspace_id: string;
};

export function parseGroupBy(raw: string | null): UsageGroupBy {
  const valid: UsageGroupBy[] = [
    "provider",
    "model",
    "workspace",
    "employee",
    "role",
    "work_type",
    "plan",
    "day",
  ];
  return valid.includes(raw as UsageGroupBy) ? (raw as UsageGroupBy) : "provider";
}

export function parseCohort(raw: string | null): UsageCohort {
  if (raw === "hired" || raw === "maya" || raw === "all") return raw;
  return "all";
}

function isMayaEvent(e: UsageEvent): boolean {
  return e.employee_id === MAYA_EMPLOYEE_ID;
}

function eventMatchesCohort(e: UsageEvent, cohort: UsageCohort): boolean {
  if (cohort === "all") return true;
  if (cohort === "maya") return isMayaEvent(e);
  return !isMayaEvent(e);
}

function emptyBreakdownAgg() {
  return {
    costUsd: 0,
    count: 0,
    inputTokens: 0,
    outputTokens: 0,
    fallbackCount: 0,
    failedCount: 0,
  };
}

function bumpBreakdown(
  map: Map<string, ReturnType<typeof emptyBreakdownAgg> & { label: string; subtitle?: string }>,
  key: string,
  label: string,
  event: UsageEvent,
  subtitle?: string,
) {
  const entry = map.get(key) ?? { ...emptyBreakdownAgg(), label, subtitle };
  entry.costUsd += effectiveCostUsd(event);
  entry.count += 1;
  entry.inputTokens += Number(event.input_tokens ?? 0);
  entry.outputTokens += Number(event.output_tokens ?? 0);
  if (event.fallback_used) entry.fallbackCount += 1;
  if (event.status === "failed" || event.status === "blocked") entry.failedCount += 1;
  if (subtitle && !entry.subtitle) entry.subtitle = subtitle;
  map.set(key, entry);
}

function finalizeBreakdown(
  map: Map<string, ReturnType<typeof emptyBreakdownAgg> & { label: string; subtitle?: string }>,
): UsageBreakdownRow[] {
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      subtitle: v.subtitle,
      costUsd: Math.round(v.costUsd * 10000) / 10000,
      count: v.count,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      fallbackCount: v.fallbackCount,
      failedCount: v.failedCount,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

export async function getUsageSummary(
  client: SupabaseClient,
  range: AdminRange,
  groupBy: UsageGroupBy,
  cohort: UsageCohort = "all",
): Promise<UsageSummary> {
  const since = rangeStart(range);

  const [eventsRes, ledgerRes, costLedgerRes, workspacesRes, employeesRes] = await Promise.all([
    client
      .from("ai_usage_events")
      .select(
        "workspace_id, employee_id, provider, model, status, fallback_used, input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, error_message, created_at",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("ai_work_minutes_ledger")
      .select(
        "workspace_id, employee_id, work_type, work_minutes_estimated, estimated_cost_usd, actual_cost_usd, created_at",
      )
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("ai_cost_ledger_entries")
      .select(
        "workspace_id, employee_id, work_type, actual_cost_usd, estimated_cost_usd, input_tokens, output_tokens, created_at",
      )
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
    client.from("workspaces").select("id, name, plan").limit(AGGREGATION_ROW_LIMIT),
    client
      .from("ai_employees")
      .select("id, name, role, role_key, system_employee_key, workspace_id")
      .limit(AGGREGATION_ROW_LIMIT),
  ]);

  for (const res of [eventsRes, ledgerRes, costLedgerRes, workspacesRes, employeesRes]) {
    if (res.error) throw res.error;
  }

  const events = (eventsRes.data ?? []) as UsageEvent[];
  const shadowLedger = ledgerRes.data ?? [];
  const costLedger = costLedgerRes.data ?? [];
  const workspaceById = new Map((workspacesRes.data ?? []).map((w) => [w.id, w]));
  const employees = (employeesRes.data ?? []) as EmployeeLookup[];

  // Prefer workspace-scoped employee rows; fall back to global id match.
  const employeeByWsId = new Map<string, EmployeeLookup>();
  const employeeById = new Map<string, EmployeeLookup>();
  for (const e of employees) {
    employeeByWsId.set(`${e.workspace_id}:${e.id}`, e);
    if (!employeeById.has(e.id)) employeeById.set(e.id, e);
  }

  const resolveEmployee = (workspaceId: string, employeeId: string | null) => {
    if (!employeeId) return null;
    return employeeByWsId.get(`${workspaceId}:${employeeId}`) ?? employeeById.get(employeeId) ?? null;
  };

  const isMayaEmployeeRow = (e: EmployeeLookup | null) =>
    Boolean(
      e &&
        (e.id === MAYA_EMPLOYEE_ID ||
          e.system_employee_key === MAYA_SYSTEM_EMPLOYEE_KEY ||
          e.system_employee_key === "maya"),
    );

  const mayaEvents = events.filter(isMayaEvent);
  const hiredEvents = events.filter((e) => !isMayaEvent(e));
  const filteredEvents = events.filter((e) => eventMatchesCohort(e, cohort));

  // Hiring journey COGS often lands on work units / cost ledger without emp-maya on usage events.
  const hiringCostRows = costLedger.filter((r) => isMayaHiringWorkType(r.work_type));
  const hiringCostUsd = sumBy(hiringCostRows, (r) =>
    Number(r.actual_cost_usd ?? r.estimated_cost_usd ?? 0),
  );
  const hiringInputTokens = sumBy(hiringCostRows, (r) => Number(r.input_tokens ?? 0));
  const hiringOutputTokens = sumBy(hiringCostRows, (r) => Number(r.output_tokens ?? 0));

  const mayaDirectCost = sumBy(mayaEvents, effectiveCostUsd);
  const mayaCostUsd = Math.round((mayaDirectCost + hiringCostUsd) * 10000) / 10000;
  const hiredCostUsd = Math.round(sumBy(hiredEvents, effectiveCostUsd) * 10000) / 10000;
  const allCostUsd = Math.round(sumBy(events, effectiveCostUsd) * 10000) / 10000;

  // Cohort-scoped event set for totals (Maya adds hiring ledger events as synthetic).
  type ScopedRow = UsageEvent & { work_type?: string | null; synthetic?: boolean };
  const scoped: ScopedRow[] = [...filteredEvents];
  if (cohort === "maya" || cohort === "all") {
    // For maya cohort, inject hiring cost rows that aren't already covered by emp-maya events.
    // For all, hiring is usually already in events if they went through usage — still add
    // hiring ledger cost that has no matching usage event employee.
    if (cohort === "maya") {
      for (const row of hiringCostRows) {
        scoped.push({
          workspace_id: String(row.workspace_id),
          employee_id: MAYA_EMPLOYEE_ID,
          provider: "hiring",
          model: String(row.work_type ?? "hiring"),
          status: "succeeded",
          fallback_used: false,
          input_tokens: Number(row.input_tokens ?? 0),
          output_tokens: Number(row.output_tokens ?? 0),
          estimated_cost_usd: Number(row.estimated_cost_usd ?? 0),
          actual_cost_usd: Number(row.actual_cost_usd ?? 0),
          error_message: null,
          created_at: String(row.created_at),
          work_type: row.work_type,
          synthetic: true,
        });
      }
    }
  }
  if (cohort === "hired") {
    // no hiring injection
  }

  const failedCount = scoped.filter((e) => e.status === "failed").length;
  const blockedCount = scoped.filter((e) => e.status === "blocked").length;
  const fallbackCount = scoped.filter((e) => e.fallback_used).length;

  const breakdownMap = new Map<
    string,
    ReturnType<typeof emptyBreakdownAgg> & { label: string; subtitle?: string }
  >();

  if (groupBy === "work_type") {
    // Prefer commercial ledger work_type when present; else shadow ledger; else provider bucket.
    const costRowsForCohort = costLedger.filter((r) => {
      const emp = r.employee_id ? String(r.employee_id) : null;
      const hiring = isMayaHiringWorkType(r.work_type);
      const maya =
        emp === MAYA_EMPLOYEE_ID ||
        hiring ||
        isMayaEmployeeRow(resolveEmployee(String(r.workspace_id), emp));
      if (cohort === "maya") return maya;
      if (cohort === "hired") return !maya;
      return true;
    });
    const source =
      costRowsForCohort.length > 0
        ? costRowsForCohort.map((r) => ({
            key: String(r.work_type ?? "unknown"),
            cost: Number(r.actual_cost_usd ?? r.estimated_cost_usd ?? 0),
            input: Number(r.input_tokens ?? 0),
            output: Number(r.output_tokens ?? 0),
          }))
        : shadowLedger
            .filter((r) => {
              const hiring = isMayaHiringWorkType(r.work_type);
              const maya = r.employee_id === MAYA_EMPLOYEE_ID || hiring;
              if (cohort === "maya") return maya;
              if (cohort === "hired") return !maya;
              return true;
            })
            .map((r) => ({
              key: String(r.work_type ?? "unknown"),
              cost: Number(r.actual_cost_usd ?? r.estimated_cost_usd ?? 0),
              input: 0,
              output: 0,
            }));

    for (const row of source) {
      const entry = breakdownMap.get(row.key) ?? {
        ...emptyBreakdownAgg(),
        label: row.key,
      };
      entry.costUsd += row.cost;
      entry.count += 1;
      entry.inputTokens += row.input;
      entry.outputTokens += row.output;
      breakdownMap.set(row.key, entry);
    }
  } else {
    for (const e of scoped) {
      const emp = resolveEmployee(e.workspace_id, e.employee_id);
      let key: string;
      let label: string;
      let subtitle: string | undefined;

      switch (groupBy) {
        case "model":
          key = e.model ?? "unknown";
          label = key;
          break;
        case "workspace":
          key = e.workspace_id;
          label = workspaceById.get(key)?.name ?? key;
          break;
        case "employee":
          key = e.employee_id ?? "unassigned";
          label =
            key === MAYA_EMPLOYEE_ID
              ? "Maya"
              : emp?.name ?? (key === "unassigned" ? "Unassigned" : key);
          subtitle = key !== "unassigned" ? key : undefined;
          break;
        case "role": {
          if (e.employee_id === MAYA_EMPLOYEE_ID || isMayaEmployeeRow(emp)) {
            key = "role:workforce_guide";
            label = "Workforce guide";
            subtitle = "Maya";
          } else {
            const roleTitle = (emp?.role ?? "").trim() || "Unknown role";
            const roleKey = (emp?.role_key ?? "").trim();
            key = `role:${roleKey || roleTitle.toLowerCase()}`;
            label = roleTitle;
            subtitle = roleKey || undefined;
          }
          break;
        }
        case "plan":
          key = workspaceById.get(e.workspace_id)?.plan ?? "unknown";
          label = key;
          break;
        case "day":
          key = (e.created_at ?? "").slice(0, 10);
          label = key;
          break;
        default:
          key = e.provider ?? "unknown";
          label = key;
      }

      bumpBreakdown(breakdownMap, key, label, e, subtitle);
    }
  }

  let breakdown = finalizeBreakdown(breakdownMap);
  if (groupBy === "day") {
    breakdown = breakdown.sort((a, b) => a.key.localeCompare(b.key));
  }

  // Day series for charts — always dual maya/hired for the full range.
  const dayMap = new Map<string, UsageDayPoint>();
  const ensureDay = (day: string) => {
    const entry = dayMap.get(day) ?? {
      day,
      costUsd: 0,
      mayaCostUsd: 0,
      hiredCostUsd: 0,
      eventCount: 0,
    };
    dayMap.set(day, entry);
    return entry;
  };
  for (const e of events) {
    const day = (e.created_at ?? "").slice(0, 10);
    if (!day) continue;
    const entry = ensureDay(day);
    const cost = effectiveCostUsd(e);
    entry.costUsd += cost;
    entry.eventCount += 1;
    if (isMayaEvent(e)) entry.mayaCostUsd += cost;
    else entry.hiredCostUsd += cost;
  }
  for (const row of hiringCostRows) {
    const day = String(row.created_at ?? "").slice(0, 10);
    if (!day) continue;
    const entry = ensureDay(day);
    const cost = Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0);
    entry.mayaCostUsd += cost;
    entry.costUsd += cost;
  }
  const daySeries = [...dayMap.values()]
    .map((d) => ({
      ...d,
      costUsd: Math.round(d.costUsd * 10000) / 10000,
      mayaCostUsd: Math.round(d.mayaCostUsd * 10000) / 10000,
      hiredCostUsd: Math.round(d.hiredCostUsd * 10000) / 10000,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // Maya panel
  const mayaWs = new Map<
    string,
    { costUsd: number; eventCount: number; inputTokens: number; outputTokens: number }
  >();
  for (const e of mayaEvents) {
    const entry = mayaWs.get(e.workspace_id) ?? {
      costUsd: 0,
      eventCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    entry.costUsd += effectiveCostUsd(e);
    entry.eventCount += 1;
    entry.inputTokens += Number(e.input_tokens ?? 0);
    entry.outputTokens += Number(e.output_tokens ?? 0);
    mayaWs.set(e.workspace_id, entry);
  }
  for (const row of hiringCostRows) {
    const ws = String(row.workspace_id);
    const entry = mayaWs.get(ws) ?? {
      costUsd: 0,
      eventCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    entry.costUsd += Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0);
    entry.eventCount += 1;
    entry.inputTokens += Number(row.input_tokens ?? 0);
    entry.outputTokens += Number(row.output_tokens ?? 0);
    mayaWs.set(ws, entry);
  }

  const maya: MayaUsagePanel = {
    costUsd: mayaCostUsd,
    eventCount: mayaEvents.length + hiringCostRows.length,
    inputTokens:
      sumBy(mayaEvents, (e) => Number(e.input_tokens ?? 0)) + hiringInputTokens,
    outputTokens:
      sumBy(mayaEvents, (e) => Number(e.output_tokens ?? 0)) + hiringOutputTokens,
    directChatCostUsd: Math.round(mayaDirectCost * 10000) / 10000,
    hiringCostUsd: Math.round(hiringCostUsd * 10000) / 10000,
    topWorkspaces: [...mayaWs.entries()]
      .map(([workspaceId, v]) => ({
        workspaceId,
        workspaceName: workspaceById.get(workspaceId)?.name ?? workspaceId,
        costUsd: Math.round(v.costUsd * 10000) / 10000,
        eventCount: v.eventCount,
        inputTokens: v.inputTokens,
        outputTokens: v.outputTokens,
      }))
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 15),
  };

  const failures = scoped
    .filter((e) => e.status === "failed" || e.status === "blocked")
    .slice(0, 25)
    .map((e) => ({
      provider: e.provider ?? "unknown",
      model: e.model ?? "unknown",
      workspaceName: workspaceById.get(e.workspace_id)?.name ?? e.workspace_id,
      errorMessage: e.error_message ? String(e.error_message).slice(0, 200) : null,
      createdAt: e.created_at,
    }));

  const scopedCost =
    cohort === "maya"
      ? mayaCostUsd
      : cohort === "hired"
        ? hiredCostUsd
        : allCostUsd;

  const shadowForCohort = shadowLedger.filter((r) => {
    const hiring = isMayaHiringWorkType(r.work_type);
    const maya = r.employee_id === MAYA_EMPLOYEE_ID || hiring;
    if (cohort === "maya") return maya;
    if (cohort === "hired") return !maya;
    return true;
  });

  return {
    range,
    groupBy,
    cohort,
    totals: {
      costUsd: Math.round(scopedCost * 10000) / 10000,
      inputTokens: sumBy(scoped, (e) => Number(e.input_tokens ?? 0)),
      outputTokens: sumBy(scoped, (e) => Number(e.output_tokens ?? 0)),
      eventCount: scoped.length,
      failedCount,
      blockedCount,
      fallbackCount,
      fallbackRate:
        scoped.length > 0 ? Math.round((fallbackCount / scoped.length) * 1000) / 10 : 0,
      workMinutes:
        Math.round(sumBy(shadowForCohort, (r) => Number(r.work_minutes_estimated)) * 100) / 100,
    },
    cohortTotals: {
      allCostUsd,
      hiredCostUsd,
      mayaCostUsd,
      allEvents: events.length,
      hiredEvents: hiredEvents.length,
      mayaEvents: mayaEvents.length + hiringCostRows.length,
    },
    breakdown: breakdown.slice(0, 50),
    daySeries,
    maya,
    failures,
  };
}
