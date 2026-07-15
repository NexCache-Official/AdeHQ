"use client";

import Link from "next/link";
import { AIEmployee } from "@/lib/types";
import { formatEmployeeIntelligenceSummary } from "@/lib/ai/intelligence-policy";
import { effectiveEmployeeStatus, isSystemEmployee } from "@/lib/maya-employee";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { EmployeeStatusBadge } from "./EmployeeStatusBadge";
import { MessageSquare, Sparkles } from "lucide-react";

export function EmployeeCard({
  employee,
  onMessage,
  compact,
  badge,
}: {
  employee: AIEmployee;
  onMessage?: (e: AIEmployee) => void;
  compact?: boolean;
  badge?: string;
}) {
  const systemGuide = isSystemEmployee(employee);
  const badgeLabel = badge ?? (systemGuide ? "Guide" : "AI");

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
              {badgeLabel}
            </span>
          </div>
          <p className="truncate text-xs text-ink-2">{employee.role}</p>
        </div>
        <EmployeeStatusBadge status={effectiveEmployeeStatus(employee)} />
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
              {badgeLabel}
            </span>
          </div>
          <p className="truncate text-xs text-ink-2">{employee.role}</p>
          <div className="mt-2">
            <EmployeeStatusBadge status={effectiveEmployeeStatus(employee)} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-3">
        {!systemGuide && (
          <>
            <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            <span className="truncate">
              {formatEmployeeIntelligenceSummary(employee)}
            </span>
          </>
        )}
        {systemGuide && <span>Your workforce recruiting & employee-ops manager</span>}
      </div>

      {!systemGuide && employee.tools.length > 0 && (
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
