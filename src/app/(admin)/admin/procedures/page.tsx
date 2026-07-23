import { AdminPageHeader } from "@/components/admin/common";
import { PROCEDURE_REGISTRY, listProcedureKeys } from "@/lib/procedures/registry";
import { isProcedureRuntimeV1Enabled } from "@/lib/procedures/flags";

export default function AdminProceduresPage() {
  const keys = listProcedureKeys();
  const runtime = isProcedureRuntimeV1Enabled();

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Procedures"
        subtitle="PR-25 registered procedure backpack (static registry)."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Registered
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
            {keys.length}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Runtime flag
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900">
            {runtime ? "ON" : "OFF"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Core trust
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
            {keys.filter((k) => PROCEDURE_REGISTRY[k]?.trustLevel === "core").length}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Executor</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Engine</th>
              <th className="px-3 py-2">Trust</th>
              <th className="px-3 py-2">Timeout</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const m = PROCEDURE_REGISTRY[key];
              return (
                <tr key={key} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
                    {m.executorKey}
                  </td>
                  <td className="px-3 py-2 text-slate-800">{m.name}</td>
                  <td className="px-3 py-2 text-slate-600">{m.category}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{m.engine}</td>
                  <td className="px-3 py-2 text-slate-600">{m.trustLevel}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{m.timeoutMs}ms</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
