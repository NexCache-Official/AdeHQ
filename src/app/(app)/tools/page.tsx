"use client";

import { useState } from "react";
import { useStore } from "@/lib/demo-store";
import { PageContainer, PageHeader } from "@/components/Page";
import { ToolCard } from "@/components/ToolCard";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { Tool, ToolCategory } from "@/lib/types";
import { toolIcon, TOOL_STATUS_META } from "@/lib/icons";
import { displayToolStatus, isInternalTool, isToolConnectable } from "@/lib/tools/catalog";
import { cn, timeAgo } from "@/lib/utils";
import { Wrench } from "lucide-react";

const CATEGORY_ORDER: ToolCategory[] = [
  "Business",
  "Fundraising",
  "Research",
  "Coding",
  "Design",
  "Communication",
  "Productivity",
  "Storage",
  "Game development",
  "Model providers",
];

export default function ToolsPage() {
  const { state } = useStore();
  const [detail, setDetail] = useState<Tool | null>(null);

  const internalTools = state.tools.filter((t) => isInternalTool(t.id));
  const externalByCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    tools: state.tools.filter((t) => !isInternalTool(t.id) && t.category === cat),
  })).filter((g) => g.tools.length > 0);

  return (
    <PageContainer wide>
      <PageHeader
        title="Tool Backpack"
        subtitle="Built-in AdeHQ apps are ready to use. Connect third-party tools when integrations launch."
        icon={<Wrench className="h-5 w-5" />}
      />

      <div className="space-y-8">
        {internalTools.length > 0 && (
          <section>
            <h2 className="mb-1 text-sm font-semibold text-slate-900">Built into AdeHQ</h2>
            <p className="mb-3 text-xs text-slate-500">
              Native apps your AI employees can use right away — no setup required.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {internalTools.map((t) => (
                <ToolCard key={t.id} tool={t} onClick={() => setDetail(t)} />
              ))}
            </div>
          </section>
        )}

        {externalByCategory.map(({ cat, tools }) => (
          <section key={cat}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">{cat}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {tools.map((t) => (
                <ToolCard key={t.id} tool={t} onClick={() => setDetail(t)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {detail && <ToolDetailModal tool={detail} onClose={() => setDetail(null)} />}
    </PageContainer>
  );
}

function ToolDetailModal({ tool, onClose }: { tool: Tool; onClose: () => void }) {
  const { state, actions } = useStore();
  const current = state.tools.find((t) => t.id === tool.id) ?? tool;
  const displayStatus = displayToolStatus(current.id, current.status);
  const Icon = toolIcon(current.id);
  const meta = TOOL_STATUS_META[displayStatus];
  const connectedEmployees = state.employees.filter((e) => e.tools.some((t) => t.toolId === current.id));
  const internal = isInternalTool(current.id);
  const connectable = isToolConnectable(current.id, current.status);

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader
        title={current.name}
        subtitle={current.category}
        onClose={onClose}
        icon={<Icon className="h-5 w-5" />}
      />
      <div className="space-y-5 p-5">
        <p className="text-sm leading-relaxed text-slate-600">{current.description}</p>

        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3.5">
          <div>
            <div className="text-xs font-medium text-slate-500">Status</div>
            <div className={cn("mt-0.5 flex items-center gap-1.5 text-sm font-medium", meta.color)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} /> {meta.label}
            </div>
          </div>
          {internal ? (
            <span className="text-xs text-slate-500">Included with your workspace</span>
          ) : displayStatus === "coming_soon" ? (
            <Button size="sm" variant="secondary" disabled>
              Coming soon
            </Button>
          ) : connectable && current.status === "not_connected" ? (
            <Button size="sm" disabled title="OAuth connection flow launching soon">
              Connect
            </Button>
          ) : connectable ? (
            <Button size="sm" variant="secondary" onClick={() => actions.setToolStatus(current.id, "not_connected")}>
              Disconnect
            </Button>
          ) : null}
        </div>

        <div>
          <div className="section-title mb-2">Employees with access ({connectedEmployees.length})</div>
          {connectedEmployees.length === 0 ? (
            <p className="text-sm text-slate-500">No employees have this tool yet.</p>
          ) : (
            <div className="space-y-2">
              {connectedEmployees.map((e) => {
                const access = e.tools.find((t) => t.toolId === current.id)!;
                const accessMeta = TOOL_STATUS_META[displayToolStatus(access.toolId, access.status)];
                return (
                  <div key={e.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                    <EmployeeAvatar employee={e} size="sm" showStatus={false} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800">{e.name}</div>
                      <div className="text-[11px] text-slate-500">
                        Permission: {access.permission} · {accessMeta.label}
                      </div>
                    </div>
                    {access.lastUsedAt && <span className="text-[10px] text-slate-600">Used {timeAgo(access.lastUsedAt)}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {displayStatus === "coming_soon" && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            This integration is on our roadmap. AdeHQ built-in apps cover the core workflow today.
          </p>
        )}
      </div>
    </Modal>
  );
}
