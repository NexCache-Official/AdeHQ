import { AdminPageHeader } from "@/components/admin/common";
import { isPlaybookRuntimeV1Enabled } from "@/lib/playbooks/flags";

const PLACEHOLDER_STATS = [
  { label: "Runs (24h)", value: "—" },
  { label: "Active", value: "—" },
  { label: "Failed", value: "—" },
  { label: "Avg WH / run", value: "—" },
];

export default function AdminPlaybookRunsPage() {
  const runtime = isPlaybookRuntimeV1Enabled();

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Playbook runs"
        subtitle="PR-25 run diagnostics. Live DB stats arrive once runtime is enabled in production."
      />

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        Runtime flag:{" "}
        <span className="font-semibold text-slate-900">{runtime ? "ON" : "OFF"}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {PLACEHOLDER_STATS.map((s) => (
          <div key={s.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {s.label}
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Run id</th>
              <th className="px-3 py-2">Playbook</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">WH</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100">
              <td className="px-3 py-6 text-center text-slate-400" colSpan={5}>
                No live run feed wired yet — use seed catalog + API smoke once runtime is ON.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
