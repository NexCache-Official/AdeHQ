"use client";

import { Tool } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { toolIcon, TOOL_STATUS_META } from "@/lib/icons";
import { displayToolStatus } from "@/lib/tools/catalog";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";

export function ToolCard({ tool, onClick }: { tool: Tool; onClick?: () => void }) {
  const { state } = useStore();
  const Icon = toolIcon(tool.id);
  const displayStatus = displayToolStatus(tool.id, tool.status);
  const meta = TOOL_STATUS_META[displayStatus];
  const employeesWithAccess = state.employees.filter((e) =>
    e.tools.some((t) => t.toolId === tool.id),
  ).length;

  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition-all hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-700 transition-colors group-hover:bg-accent-500/15 group-hover:text-accent-700">
          <Icon className="h-5 w-5" />
        </div>
        <span className={cn("flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1 text-[11px] font-medium", meta.color)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>
      </div>
      <div>
        <div className="text-sm font-semibold text-slate-900">{tool.name}</div>
        <div className="text-[11px] text-slate-500">{tool.category}</div>
      </div>
      <p className="line-clamp-2 text-xs text-slate-500">{tool.description}</p>
      <div className="mt-auto flex items-center gap-1.5 border-t border-slate-200 pt-3 text-[11px] text-slate-500">
        <Users className="h-3.5 w-3.5" />
        {employeesWithAccess} {employeesWithAccess === 1 ? "employee" : "employees"} with access
      </div>
    </button>
  );
}
