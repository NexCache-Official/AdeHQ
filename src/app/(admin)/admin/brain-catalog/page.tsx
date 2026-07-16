import { AdminPageHeader } from "@/components/admin/common";
import {
  BRAIN_ROUTES,
  CATALOG_VERSION,
  getLiveSeedSnapshot,
  type BrainRouteEnvironment,
  type CapabilityRoute,
} from "@/lib/brain/catalog";

const ENV_ORDER: BrainRouteEnvironment[] = [
  "production",
  "fallback",
  "shadow",
  "evaluation",
  "disabled",
];

const ENV_BADGE: Record<BrainRouteEnvironment, string> = {
  production: "bg-emerald-100 text-emerald-800",
  fallback: "bg-amber-100 text-amber-900",
  shadow: "bg-sky-100 text-sky-900",
  evaluation: "bg-violet-100 text-violet-900",
  disabled: "bg-slate-200 text-slate-600",
};

function rateSummary(route: CapabilityRoute): string {
  const snap = getLiveSeedSnapshot(route.id);
  if (!snap) return route.environment === "disabled" ? "—" : "missing snapshot";
  if (snap.inputPerMillion != null) {
    const cached =
      snap.cachedInputPerMillion != null && snap.cachedInputPerMillion !== snap.inputPerMillion
        ? ` / $${snap.cachedInputPerMillion} cached`
        : "";
    return `$${snap.inputPerMillion} / $${snap.outputPerMillion} per 1M${cached}`;
  }
  if (snap.perImage != null) return `$${snap.perImage}/image`;
  if (snap.perVideo != null) return `$${snap.perVideo}/video`;
  if (snap.perThousandUtf8Bytes != null) return `$${snap.perThousandUtf8Bytes}/1K UTF-8`;
  if (snap.perSearchRequest != null) return `$${snap.perSearchRequest}/request`;
  if (snap.perBrowserSecond != null) return `$${snap.perBrowserSecond}/sec (placeholder)`;
  return "—";
}

/**
 * AdeHQ Control — full Brain catalog (PR-11).
 * Read-only. Shadow/evaluation/disabled routes are NOT live.
 */
export default function AdminBrainCatalogPage() {
  const grouped = ENV_ORDER.map((env) => ({
    env,
    routes: BRAIN_ROUTES.filter((r) => r.environment === env),
  })).filter((g) => g.routes.length > 0);

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Brain catalog"
        subtitle={`CATALOG_VERSION=${CATALOG_VERSION}. Exact routes, prices, and lifecycle states. Vision + image + video are live; voice/TTS remains shadow.`}
      />

      <div className="grid gap-3 sm:grid-cols-5">
        {ENV_ORDER.map((env) => (
          <div key={env} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {env}
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {BRAIN_ROUTES.filter((r) => r.environment === env).length}
            </div>
          </div>
        ))}
      </div>

      {grouped.map(({ env, routes }) => (
        <section key={env} className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${ENV_BADGE[env]}`}>
              {env}
            </span>
            <span className="text-slate-500">{routes.length} routes</span>
          </h2>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Route</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Capability</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Pricing</th>
                  <th className="px-3 py-2">Fallbacks</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((route) => (
                  <tr key={route.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{route.id}</td>
                    <td className="px-3 py-2 text-slate-800">{route.label}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{route.model}</td>
                    <td className="px-3 py-2 text-slate-600">{route.capability}</td>
                    <td className="px-3 py-2 text-slate-600">{route.provider}</td>
                    <td className="px-3 py-2 text-slate-600">{route.unitType}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{rateSummary(route)}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">
                      {route.fallbackRouteIds?.length
                        ? route.fallbackRouteIds.join(", ")
                        : route.fallbackForRouteId
                          ? `← ${route.fallbackForRouteId}`
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <p className="text-xs text-slate-500">
        Members never see model IDs. This page is Control-only. Live scoring uses{" "}
        <code className="rounded bg-slate-100 px-1">environment=production</code> only.
      </p>
    </div>
  );
}
