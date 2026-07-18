import type { SupabaseClient } from "@supabase/supabase-js";
import { MAYA_EMPLOYEE_ID } from "@/lib/hiring/maya";
import { isMayaHiringWorkType } from "@/lib/billing/costing/maya-exempt";
import { listPublishedPublicCatalog } from "@/lib/billing/commerce/catalog";
import { AGGREGATION_ROW_LIMIT, rangeStart, type AdminRange } from "./helpers";

export type EconomicsRange = AdminRange | "ytd";

export type EconomicsDayPoint = {
  day: string;
  revenueUsd: number;
  cogsUsd: number;
  mayaCogsUsd: number;
  hiredCogsUsd: number;
  grossProfitUsd: number;
};

export type EconomicsStatementLine = {
  date: string;
  type: "invoice" | "cogs";
  workspaceId: string;
  workspaceName: string;
  planSlug: string | null;
  amountUsd: number;
  note: string;
};

export type EconomicsSummary = {
  range: EconomicsRange;
  currency: string;
  metrics: {
    revenueUsd: number;
    cogsUsd: number;
    mayaCogsUsd: number;
    hiredCogsUsd: number;
    grossProfitUsd: number;
    grossMarginPct: number;
    mrrUsd: number;
    arrUsd: number;
    payingWorkspaces: number;
    paidInvoiceCount: number;
  };
  revenueByPlan: Array<{ planSlug: string; label: string; revenueUsd: number; count: number }>;
  cogsByWorkspace: Array<{
    workspaceId: string;
    workspaceName: string;
    cogsUsd: number;
    mayaCogsUsd: number;
    hiredCogsUsd: number;
  }>;
  daySeries: EconomicsDayPoint[];
  recentInvoices: Array<{
    id: string;
    workspaceName: string;
    amountUsd: number;
    status: string;
    createdAt: string;
    planSlug: string | null;
  }>;
  statement: EconomicsStatementLine[];
};

const PAID_STATUSES = new Set(["active", "trialing", "past_due", "comped", "manual", "enterprise"]);

type SubRow = {
  id: string;
  workspace_id: string;
  status: string;
  plan_slug: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type PlanRow = {
  plan_slug: string;
  display_name: string | null;
  monthly_price_cents: number | null;
  annual_price_cents: number | null;
};

export function parseEconomicsRange(raw: string | null): EconomicsRange {
  if (raw === "ytd") return "ytd";
  if (raw === "1d" || raw === "7d" || raw === "30d" || raw === "90d") return raw;
  return "30d";
}

function economicsSince(range: EconomicsRange): string {
  if (range === "ytd") {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).toISOString();
  }
  return rangeStart(range);
}

function money(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Monthly recurring revenue in cents from latest paid sub per workspace. */
export function computeMrrCents<T extends SubRow>(params: {
  subscriptions: T[];
  planBySlug: Map<string, PlanRow>;
  /** Prefer commerce monthly amount_minor (cents) when present. */
  commerceMonthlyCentsByPlan?: Map<string, number>;
}): { mrrCents: number; payingWorkspaces: number; latestByWorkspace: Map<string, T> } {
  const latestByWorkspace = new Map<string, T>();
  for (const sub of params.subscriptions) {
    if (!latestByWorkspace.has(sub.workspace_id)) {
      latestByWorkspace.set(sub.workspace_id, sub);
    }
  }

  let mrrCents = 0;
  let payingWorkspaces = 0;
  for (const sub of latestByWorkspace.values()) {
    if (!PAID_STATUSES.has(sub.status)) continue;
    payingWorkspaces += 1;
    const cadence =
      String(sub.metadata?.interval ?? sub.metadata?.billing_cadence ?? "monthly") === "annual"
        ? "annual"
        : "monthly";
    const commerce = params.commerceMonthlyCentsByPlan?.get(sub.plan_slug);
    const plan = params.planBySlug.get(sub.plan_slug);
    let monthly = 0;
    if (cadence === "monthly" && commerce != null && commerce > 0) {
      monthly = commerce;
    } else if (plan) {
      monthly =
        cadence === "annual"
          ? Math.round(Number(plan.annual_price_cents ?? 0) / 12)
          : Number(plan.monthly_price_cents ?? 0);
    }
    if (Number.isFinite(monthly) && monthly > 0) mrrCents += monthly;
  }

  return { mrrCents, payingWorkspaces, latestByWorkspace };
}

export async function sumPaidInvoiceCents(
  client: SupabaseClient,
  sinceIso?: string,
): Promise<{ totalCents: number; count: number; rows: Array<{
  id: string;
  workspace_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  created_at: string;
}> }> {
  let query = client
    .from("billing_invoices")
    .select("id, workspace_id, status, amount_cents, currency, created_at")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(AGGREGATION_ROW_LIMIT);
  if (sinceIso) query = query.gte("created_at", sinceIso);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []).map((r) => ({
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    amount_cents: Number(r.amount_cents ?? 0),
    currency: String(r.currency ?? "usd"),
    status: String(r.status ?? "paid"),
    created_at: String(r.created_at),
  }));
  const totalCents = rows.reduce((s, r) => s + r.amount_cents, 0);
  return { totalCents, count: rows.length, rows };
}

export async function getEconomicsSummary(
  client: SupabaseClient,
  range: EconomicsRange,
): Promise<EconomicsSummary> {
  const since = economicsSince(range);

  const [invoicePack, ledgerRes, subsRes, plansRes, workspacesRes, catalog] =
    await Promise.all([
      sumPaidInvoiceCents(client, since),
      client
        .from("ai_cost_ledger_entries")
        .select(
          "workspace_id, employee_id, work_type, actual_cost_usd, estimated_cost_usd, created_at",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(AGGREGATION_ROW_LIMIT),
      client
        .from("billing_subscriptions")
        .select("id, workspace_id, status, plan_slug, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      client
        .from("platform_plan_configs")
        .select("plan_slug, display_name, monthly_price_cents, annual_price_cents"),
      client.from("workspaces").select("id, name").limit(AGGREGATION_ROW_LIMIT),
      listPublishedPublicCatalog(client, "USD").catch(() => []),
    ]);

  if (ledgerRes.error) throw ledgerRes.error;
  if (subsRes.error) throw subsRes.error;
  if (plansRes.error) throw plansRes.error;
  if (workspacesRes.error) throw workspacesRes.error;

  const workspaceName = new Map(
    (workspacesRes.data ?? []).map((w) => [String(w.id), String(w.name ?? "Workspace")]),
  );
  const planBySlug = new Map(
    (plansRes.data ?? []).map((p) => [String(p.plan_slug), p as PlanRow]),
  );

  const commerceMonthly = new Map<string, number>();
  for (const price of catalog) {
    if (price.cadence === "monthly" && price.amountMinor > 0) {
      commerceMonthly.set(price.planCode, price.amountMinor);
    }
  }

  const invoices = invoicePack.rows;
  const revenueUsd = money(invoicePack.totalCents / 100);

  // Plan attribution via latest subscription for that workspace.
  const { mrrCents, payingWorkspaces, latestByWorkspace } = computeMrrCents({
    subscriptions: (subsRes.data ?? []) as SubRow[],
    planBySlug,
    commerceMonthlyCentsByPlan: commerceMonthly,
  });

  const revenueByPlanMap = new Map<string, { revenueUsd: number; count: number }>();
  for (const inv of invoices) {
    const slug = latestByWorkspace.get(inv.workspace_id)?.plan_slug ?? "unknown";
    const entry = revenueByPlanMap.get(slug) ?? { revenueUsd: 0, count: 0 };
    entry.revenueUsd += inv.amount_cents / 100;
    entry.count += 1;
    revenueByPlanMap.set(slug, entry);
  }

  let mayaCogsUsd = 0;
  let hiredCogsUsd = 0;
  const cogsWs = new Map<
    string,
    { cogsUsd: number; mayaCogsUsd: number; hiredCogsUsd: number }
  >();
  const dayMap = new Map<string, EconomicsDayPoint>();

  const ensureDay = (day: string) => {
    const entry = dayMap.get(day) ?? {
      day,
      revenueUsd: 0,
      cogsUsd: 0,
      mayaCogsUsd: 0,
      hiredCogsUsd: 0,
      grossProfitUsd: 0,
    };
    dayMap.set(day, entry);
    return entry;
  };

  for (const inv of invoices) {
    const day = inv.created_at.slice(0, 10);
    if (!day) continue;
    ensureDay(day).revenueUsd += inv.amount_cents / 100;
  }

  for (const row of ledgerRes.data ?? []) {
    const cost = Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0);
    if (!(cost > 0)) continue;
    const emp = row.employee_id ? String(row.employee_id) : "";
    const maya = emp === MAYA_EMPLOYEE_ID || isMayaHiringWorkType(row.work_type);
    if (maya) mayaCogsUsd += cost;
    else hiredCogsUsd += cost;

    const ws = String(row.workspace_id);
    const entry = cogsWs.get(ws) ?? { cogsUsd: 0, mayaCogsUsd: 0, hiredCogsUsd: 0 };
    entry.cogsUsd += cost;
    if (maya) entry.mayaCogsUsd += cost;
    else entry.hiredCogsUsd += cost;
    cogsWs.set(ws, entry);

    const day = String(row.created_at ?? "").slice(0, 10);
    if (day) {
      const d = ensureDay(day);
      d.cogsUsd += cost;
      if (maya) d.mayaCogsUsd += cost;
      else d.hiredCogsUsd += cost;
    }
  }

  const cogsUsd = money(mayaCogsUsd + hiredCogsUsd);
  mayaCogsUsd = money(mayaCogsUsd);
  hiredCogsUsd = money(hiredCogsUsd);
  const grossProfitUsd = money(revenueUsd - cogsUsd);
  const grossMarginPct =
    revenueUsd > 0 ? Math.round((grossProfitUsd / revenueUsd) * 1000) / 10 : 0;

  const daySeries = [...dayMap.values()]
    .map((d) => ({
      ...d,
      revenueUsd: money(d.revenueUsd),
      cogsUsd: money(d.cogsUsd),
      mayaCogsUsd: money(d.mayaCogsUsd),
      hiredCogsUsd: money(d.hiredCogsUsd),
      grossProfitUsd: money(d.revenueUsd - d.cogsUsd),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const statement: EconomicsStatementLine[] = [];
  for (const inv of invoices) {
    statement.push({
      date: inv.created_at,
      type: "invoice",
      workspaceId: inv.workspace_id,
      workspaceName: workspaceName.get(inv.workspace_id) ?? "Workspace",
      planSlug: latestByWorkspace.get(inv.workspace_id)?.plan_slug ?? null,
      amountUsd: money(inv.amount_cents / 100),
      note: "Paid invoice",
    });
  }
  for (const [ws, v] of cogsWs.entries()) {
    statement.push({
      date: since,
      type: "cogs",
      workspaceId: ws,
      workspaceName: workspaceName.get(ws) ?? "Workspace",
      planSlug: latestByWorkspace.get(ws)?.plan_slug ?? null,
      amountUsd: money(-v.cogsUsd),
      note: `AI COGS (hired ${money(v.hiredCogsUsd)} · Maya ${money(v.mayaCogsUsd)})`,
    });
  }
  statement.sort((a, b) => a.date.localeCompare(b.date));

  return {
    range,
    currency: "USD",
    metrics: {
      revenueUsd,
      cogsUsd,
      mayaCogsUsd,
      hiredCogsUsd,
      grossProfitUsd,
      grossMarginPct,
      mrrUsd: money(mrrCents / 100),
      arrUsd: money((mrrCents * 12) / 100),
      payingWorkspaces,
      paidInvoiceCount: invoicePack.count,
    },
    revenueByPlan: [...revenueByPlanMap.entries()]
      .map(([planSlug, v]) => ({
        planSlug,
        label: String(planBySlug.get(planSlug)?.display_name ?? planSlug),
        revenueUsd: money(v.revenueUsd),
        count: v.count,
      }))
      .sort((a, b) => b.revenueUsd - a.revenueUsd),
    cogsByWorkspace: [...cogsWs.entries()]
      .map(([workspaceId, v]) => ({
        workspaceId,
        workspaceName: workspaceName.get(workspaceId) ?? "Workspace",
        cogsUsd: money(v.cogsUsd),
        mayaCogsUsd: money(v.mayaCogsUsd),
        hiredCogsUsd: money(v.hiredCogsUsd),
      }))
      .sort((a, b) => b.cogsUsd - a.cogsUsd)
      .slice(0, 25),
    daySeries,
    recentInvoices: invoices.slice(0, 25).map((inv) => ({
      id: inv.id,
      workspaceName: workspaceName.get(inv.workspace_id) ?? "Workspace",
      amountUsd: money(inv.amount_cents / 100),
      status: inv.status,
      createdAt: inv.created_at,
      planSlug: latestByWorkspace.get(inv.workspace_id)?.plan_slug ?? null,
    })),
    statement,
  };
}

export function economicsStatementCsv(summary: EconomicsSummary): string {
  const header = [
    "date",
    "type",
    "workspace_id",
    "workspace_name",
    "plan_slug",
    "amount_usd",
    "note",
    "running_total_usd",
  ];
  let running = 0;
  const rows = summary.statement.map((line) => {
    running = money(running + line.amountUsd);
    return [
      line.date,
      line.type,
      line.workspaceId,
      JSON.stringify(line.workspaceName),
      line.planSlug ?? "",
      line.amountUsd.toFixed(4),
      JSON.stringify(line.note),
      running.toFixed(4),
    ].join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

export function economicsStatementHtml(summary: EconomicsSummary): string {
  const m = summary.metrics;
  const rows = summary.statement
    .map(
      (line) =>
        `<tr><td>${line.date}</td><td>${line.type}</td><td>${escapeHtml(line.workspaceName)}</td><td>${line.planSlug ?? ""}</td><td style="text-align:right">${line.amountUsd.toFixed(4)}</td><td>${escapeHtml(line.note)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>AdeHQ Economics ${summary.range}</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;padding:24px;color:#111}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f5f5f5}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}.card{border:1px solid #e5e5e5;padding:12px;border-radius:8px}.v{font-size:20px;font-weight:600}</style></head><body>
<h1>AdeHQ Economics — ${summary.range}</h1>
<div class="metrics">
<div class="card"><div>Revenue</div><div class="v">$${m.revenueUsd.toFixed(2)}</div></div>
<div class="card"><div>COGS</div><div class="v">$${m.cogsUsd.toFixed(2)}</div></div>
<div class="card"><div>Gross profit</div><div class="v">$${m.grossProfitUsd.toFixed(2)} (${m.grossMarginPct}%)</div></div>
</div>
<table><thead><tr><th>Date</th><th>Type</th><th>Workspace</th><th>Plan</th><th>Amount (USD)</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
