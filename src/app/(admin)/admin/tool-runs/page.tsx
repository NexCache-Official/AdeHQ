"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminPageHeader,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import type { ToolRunRow } from "@/lib/admin/queries/tool-runs";
import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

type Payload = { runs: ToolRunRow[]; statusCounts: Record<string, number> };

export default function AdminToolRunsPage() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [status, setStatus] = useState("");
  const [toolName, setToolName] = useState("");
  const [selected, setSelected] = useState<ToolRunRow | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (workspaceId.trim()) params.set("workspaceId", workspaceId.trim());
    if (status) params.set("status", status);
    if (toolName.trim()) params.set("toolName", toolName.trim());
    params.set("limit", "80");
    return `/api/admin/tool-runs?${params.toString()}`;
  }, [workspaceId, status, toolName]);

  const { data, loading, error, refresh } = useAdminData<Payload>(query);

  const columns: AdminColumn<ToolRunRow>[] = [
    {
      key: "created",
      header: "When",
      render: (r) => new Date(r.createdAt).toLocaleString(),
    },
    { key: "tool", header: "Tool", render: (r) => r.toolName },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
            r.status === "success" && "bg-emerald-100 text-emerald-800",
            r.status === "failed" && "bg-rose-100 text-rose-800",
            r.status === "blocked" && "bg-amber-100 text-amber-800",
            r.status === "pending" && "bg-sky-100 text-sky-800",
            r.status === "running" && "bg-violet-100 text-violet-800",
          )}
        >
          {r.status}
        </span>
      ),
    },
    {
      key: "employee",
      header: "Employee",
      render: (r) => r.employeeName ?? r.employeeId,
    },
    {
      key: "workspace",
      header: "Workspace",
      render: (r) => r.workspaceName ?? r.workspaceId.slice(0, 8),
    },
    {
      key: "cost",
      header: "Cost",
      render: (r) => `$${r.costUsd.toFixed(4)} · ${r.workMinutes}m`,
    },
    {
      key: "duration",
      header: "Duration",
      render: (r) => (r.durationMs != null ? `${r.durationMs}ms` : "—"),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Tool Runs"
        subtitle="Integration tool execution audit trail — previews, executes, failures, and async jobs."
        icon={<Wrench className="h-5 w-5" />}
        actions={
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-muted"
          >
            Refresh
          </button>
        }
      />

      <Card className="mb-4 grid gap-3 p-4 md:grid-cols-4">
        <FilterInput
          label="Workspace ID"
          value={workspaceId}
          onChange={setWorkspaceId}
          placeholder="uuid…"
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={["", "success", "failed", "blocked", "pending", "running"]}
        />
        <FilterInput
          label="Tool name"
          value={toolName}
          onChange={setToolName}
          placeholder="crm.createContact"
        />
        <div className="flex items-end">
          {data && (
            <p className="text-xs text-ink-3">
              {data.runs.length} runs
              {Object.keys(data.statusCounts).length > 0 &&
                ` · ${Object.entries(data.statusCounts)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ")}`}
            </p>
          )}
        </div>
      </Card>

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <AdminDataTable
              columns={columns}
              rows={data.runs}
              rowKey={(r) => r.id}
              emptyLabel="No tool runs match these filters."
              onRowClick={(row) => setSelected(row)}
            />

            <Card className="h-fit p-4">
              <h3 className="text-sm font-semibold text-ink">Run inspector</h3>
              {!selected ? (
                <p className="mt-3 text-sm text-ink-3">Select a run to inspect payloads.</p>
              ) : (
                <div className="mt-3 space-y-3 text-xs">
                  <InspectorField label="ID" value={selected.id} mono />
                  <InspectorField label="Tool" value={selected.toolName} />
                  <InspectorField label="Mode" value={selected.mode} />
                  <InspectorField label="Status" value={selected.status} />
                  {selected.errorMessage && (
                    <InspectorField label="Error" value={selected.errorMessage} error />
                  )}
                  {selected.externalObjectId && (
                    <InspectorField label="Linked entity" value={selected.externalObjectId} mono />
                  )}
                  {selected.approvalId && (
                    <InspectorField label="Approval" value={selected.approvalId} mono />
                  )}
                  {selected.jobId && (
                    <InspectorField label="Job" value={selected.jobId} mono />
                  )}
                  <div>
                    <div className="mb-1 font-semibold text-ink-2">Input (redacted)</div>
                    <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-2 text-[10px]">
                      {JSON.stringify(selected.inputPayload, null, 2)}
                    </pre>
                  </div>
                  {selected.outputPayload && (
                    <div>
                      <div className="mb-1 font-semibold text-ink-2">Output</div>
                      <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-2 text-[10px]">
                        {JSON.stringify(selected.outputPayload, null, 2)}
                      </pre>
                    </div>
                  )}
                  {selected.previewSnapshot && (
                    <div>
                      <div className="mb-1 font-semibold text-ink-2">Preview snapshot</div>
                      <pre className="max-h-32 overflow-auto rounded-lg bg-muted p-2 text-[10px]">
                        {JSON.stringify(selected.previewSnapshot, null, 2)}
                      </pre>
                    </div>
                  )}
                  <p className="text-[10px] text-ink-3">
                    Message content is not shown here. Use workspace ID + room ID only for support
                    routing.
                  </p>
                </div>
              )}
            </Card>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-ink-2">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-ink-2">{label}</span>
      <select
        className="mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt || "all"} value={opt}>
            {opt || "All"}
          </option>
        ))}
      </select>
    </label>
  );
}

function InspectorField({
  label,
  value,
  mono,
  error,
}: {
  label: string;
  value: string;
  mono?: boolean;
  error?: boolean;
}) {
  return (
    <div>
      <div className="font-semibold text-ink-2">{label}</div>
      <div className={cn("mt-0.5 break-all", mono && "font-mono text-[10px]", error && "text-rose-700")}>
        {value}
      </div>
    </div>
  );
}
