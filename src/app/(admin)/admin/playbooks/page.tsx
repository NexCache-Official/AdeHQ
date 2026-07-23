import { AdminPageHeader } from "@/components/admin/common";
import { PLATFORM_PLAYBOOK_SEEDS } from "@/lib/playbooks/seeds";
import { estimatePlaybookWh } from "@/lib/playbooks/estimator";
import { isPlaybookRuntimeV1Enabled, isCustomPlaybooksV1Enabled } from "@/lib/playbooks/flags";

export default function AdminPlaybooksPage() {
  const runtime = isPlaybookRuntimeV1Enabled();
  const custom = isCustomPlaybooksV1Enabled();

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Playbooks"
        subtitle="PR-25 platform seed catalog (read-only diagnostic)."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Seed playbooks
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
            {PLATFORM_PLAYBOOK_SEEDS.length}
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
            Custom playbooks
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900">
            {custom ? "ON" : "OFF"}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Steps</th>
              <th className="px-3 py-2">Roles</th>
              <th className="px-3 py-2">Est WH</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORM_PLAYBOOK_SEEDS.map((pb) => {
              const est = estimatePlaybookWh(pb);
              return (
                <tr key={pb.key} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{pb.key}</td>
                  <td className="px-3 py-2 text-slate-800">{pb.name}</td>
                  <td className="px-3 py-2 text-slate-600">{pb.category}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{pb.steps.length}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">
                    {pb.roleRequirements.length}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">
                    {est.estimatedWhMin}–{est.estimatedWhMax}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
