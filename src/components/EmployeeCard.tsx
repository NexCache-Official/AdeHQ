"use client";

import Link from "next/link";
import { AIEmployee } from "@/lib/types";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { EmployeeStatusBadge } from "./EmployeeStatusBadge";
import { MessageSquare, Sparkles } from "lucide-react";

function capacityPercent(employee: AIEmployee) {
  const base = employee.status === "working" ? 72 : employee.status === "idle" ? 28 : 45;
  return Math.min(95, base + (employee.tasksCompleted % 20));
}

export function EmployeeCard({
  employee,
  onMessage,
  compact,
}: {
  employee: AIEmployee;
  onMessage?: (e: AIEmployee) => void;
  compact?: boolean;
}) {
  const capacity = capacityPercent(employee);

  if (compact) {
    return (
      <Link
        href={`/workforce/${employee.id}`}
        className="lift flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 transition-colors hover:border-border"
      >
        <EmployeeAvatar employee={employee} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-ink">{employee.name}</span>
            <span className="rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[9px] font-bold text-accent">
              AI
            </span>
          </div>
          <p className="truncate text-xs text-ink-2">{employee.role}</p>
        </div>
        <EmployeeStatusBadge status={employee.status} />
      </Link>
    );
  }

  return (
    <div className="lift flex flex-col rounded-[18px] border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <EmployeeAvatar employee={employee} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/workforce/${employee.id}`}
              className="truncate text-[14.5px] font-semibold text-ink hover:text-accent-d"
            >
              {employee.name}
            </Link>
            <span className="rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[9px] font-bold text-accent">
              AI
            </span>
          </div>
          <p className="truncate text-xs text-ink-2">{employee.role}</p>
          <div className="mt-2">
            <EmployeeStatusBadge status={employee.status} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-3">
        <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
        <span className="truncate">
          {employee.provider} · {employee.model}
        </span>
      </div>

      {employee.tools.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {employee.tools.slice(0, 4).map((t) => (
            <span
              key={t.toolId}
              className="rounded-[7px] bg-muted px-2 py-0.5 text-[10.5px] font-medium text-ink-2"
            >
              {t.name}
            </span>
          ))}
          {employee.tools.length > 4 && (
            <span className="rounded-[7px] bg-muted px-2 py-0.5 text-[10.5px] text-ink-3">
              +{employee.tools.length - 4}
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <div className="h-[5px] flex-1 overflow-hidden rounded bg-muted">
          <div
            className="h-full rounded bg-accent transition-all"
            style={{ width: `${capacity}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{capacity}% capacity</span>
      </div>

      <div className="mt-3 flex gap-1.5">
        {onMessage && (
          <button
            type="button"
            onClick={() => onMessage(employee)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[9px] bg-accent py-2 text-xs font-semibold text-white transition-all hover:brightness-105"
          >
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
            Message
          </button>
        )}
        <Link
          href={`/workforce/${employee.id}`}
          className="flex flex-1 items-center justify-center rounded-[9px] border border-border bg-surface py-2 text-xs font-medium text-ink-2 transition-colors hover:bg-muted"
        >
          Profile
        </Link>
      </div>
    </div>
  );
}
