"use client";

import Link from "next/link";
import { AIEmployee } from "@/lib/types";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { EmployeeStatusBadge } from "./EmployeeStatusBadge";
import { Card } from "./ui";
import { toolIcon } from "@/lib/icons";
import { timeAgo } from "@/lib/utils";
import { Brain, CheckCircle2, MessageSquare, Wrench } from "lucide-react";

export function EmployeeCard({
  employee,
  onMessage,
}: {
  employee: AIEmployee;
  onMessage?: (e: AIEmployee) => void;
}) {
  return (
    <Card hover className="group flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <EmployeeAvatar employee={employee} size="lg" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/workforce/${employee.id}`}
            className="block truncate text-[15px] font-semibold text-slate-900 hover:text-accent-700"
          >
            {employee.name}
          </Link>
          <p className="truncate text-xs text-slate-500">{employee.role}</p>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="rounded-md bg-slate-50 px-1.5 py-0.5">{employee.provider}</span>
            <span>·</span>
            <span>{employee.model}</span>
          </div>
        </div>
        <EmployeeStatusBadge status={employee.status} />
      </div>

      {employee.currentTask && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Current task
          </div>
          <div className="mt-0.5 truncate text-sm text-slate-700">{employee.currentTask}</div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat icon={Wrench} value={employee.tools.length} label="tools" />
        <Stat icon={Brain} value={employee.memoryCount} label="memory" />
        <Stat icon={CheckCircle2} value={employee.tasksCompleted} label="done" />
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 pt-3">
        <div className="flex -space-x-1.5">
          {employee.tools.slice(0, 4).map((t) => {
            const TI = toolIcon(t.toolId);
            return (
              <span
                key={t.toolId}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-slate-400"
                title={t.name}
              >
                <TI className="h-3 w-3" />
              </span>
            );
          })}
          {employee.tools.length > 4 && (
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-[10px] text-slate-400">
              +{employee.tools.length - 4}
            </span>
          )}
        </div>
        <span className="ml-auto text-[11px] text-slate-500">
          Active {timeAgo(employee.lastActiveAt)}
        </span>
      </div>

      <div className="flex gap-2">
        <Link
          href={`/workforce/${employee.id}`}
          className="flex h-9 flex-1 items-center justify-center rounded-xl border border-slate-200 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          Open profile
        </Link>
        {onMessage && (
          <button
            onClick={() => onMessage(employee)}
            className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-accent-500/15 px-3 text-sm font-medium text-accent-700 transition-colors hover:bg-accent-500/25"
          >
            <MessageSquare className="h-4 w-4" />
            Message
          </button>
        )}
      </div>
    </Card>
  );
}

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Brain;
  value: number;
  label: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 py-2">
      <div className="flex items-center justify-center gap-1 text-sm font-semibold text-slate-900">
        <Icon className="h-3.5 w-3.5 text-slate-500" />
        {value}
      </div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}
