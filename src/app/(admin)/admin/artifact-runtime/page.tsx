import { AdminPageHeader } from "@/components/admin/common";
import { ARTIFACT_RENDERERS } from "@/lib/artifacts/renderers/registry";
import {
  isArtifactExportV1Enabled,
  isArtifactRuntimeV1Enabled,
  isArtifactVisualQaV1Enabled,
} from "@/lib/artifacts/flags";
import { ADEHQ_DEFAULT_BRAND_KIT } from "@/lib/artifacts/brand-kits/defaults";

export default function AdminArtifactRuntimePage() {
  const renderers = Object.values(ARTIFACT_RENDERERS);

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Artifact runtime"
        subtitle="PR-25 structured artifact pipeline — flags, renderers, default brand kit."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Runtime
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900">
            {isArtifactRuntimeV1Enabled() ? "ON" : "OFF"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Export
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900">
            {isArtifactExportV1Enabled() ? "ON" : "OFF"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Visual QA
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900">
            {isArtifactVisualQaV1Enabled() ? "ON" : "OFF"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Renderers
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
            {renderers.length}
          </div>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Renderers</h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Version</th>
                <th className="px-3 py-2">Format</th>
                <th className="px-3 py-2">MIME</th>
              </tr>
            </thead>
            <tbody>
              {renderers.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{r.key}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{r.version}</td>
                  <td className="px-3 py-2 text-slate-700">{r.format}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{r.mimeType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Default brand kit</h2>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">{ADEHQ_DEFAULT_BRAND_KIT.name}</p>
          <p className="mt-1 text-slate-500">{ADEHQ_DEFAULT_BRAND_KIT.footerText}</p>
          <p className="mt-2 font-mono text-[11px] text-slate-500">
            accent={ADEHQ_DEFAULT_BRAND_KIT.tokens.colors.accent} · display=
            {ADEHQ_DEFAULT_BRAND_KIT.tokens.typography.display}
          </p>
        </div>
      </section>
    </div>
  );
}
