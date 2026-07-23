"use client";

import Link from "next/link";
import { AIEmployee } from "@/lib/types";
import { formatEmployeeIntelligenceSummary } from "@/lib/ai/intelligence-policy";
import { effectiveEmployeeStatus, isSystemEmployee } from "@/lib/maya-employee";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { EmployeeStatusBadge } from "./EmployeeStatusBadge";
import { MessageSquare, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const badgeLabel = badge ?? (systemGuide ? "GUIDE" : "AI");
  const status = effectiveEmployeeStatus(employee);

  if (compact) {
    return (
      <Link
        href={`/workforce/${employee.id}`}
        className="flex items-center gap-3 rounded-[14px] border border-border bg-surface p-3.5 transition-colors hover:bg-muted/60"
      >
        <EmployeeAvatar employee={employee} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold tracking-[-0.01em] text-ink">{employee.name}</span>
            <span className="rounded-[5px] border border-border bg-muted px-[5px] py-px font-mono text-[9.5px] font-medium tracking-[0.06em] text-ink-3">
              {badgeLabel}
            </span>
          </div>
          <p className="truncate text-[12.5px] text-ink-3">{employee.role}</p>
        </div>
        <EmployeeStatusBadge status={status} compact />
      </Link>
    );
  }

  return (
    <div className="flex flex-col rounded-[14px] border border-border bg-surface p-4">
      <div className="flex gap-3">
        <EmployeeAvatar employee={employee} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/workforce/${employee.id}`}
              className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink hover:opacity-80"
            >
              {employee.name}
            </Link>
            <span className="rounded-[5px] border border-border bg-muted px-[5px] py-px font-mono text-[9.5px] font-medium tracking-[0.06em] text-ink-3">
              {badgeLabel}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{employee.role}</p>
        </div>
      </div>

      <div className="mt-3 self-start">
        <EmployeeStatusBadge status={status} compact className="!rounded-full !font-mono !tracking-[0.04em]" />
      </div>

      <div className="mt-3.5 flex-1">
        {systemGuide ? (
          <p className="text-[12.5px] leading-relaxed text-ink-3">
            Your workforce recruiting & employee-ops manager.
          </p>
        ) : (
          <>
            <div className="mb-2.5 flex items-center gap-1.5 text-xs text-ink-3">
              <Sparkles className="h-[13px] w-[13px] shrink-0 text-ink-3" strokeWidth={2} />
              <span className="truncate">{formatEmployeeIntelligenceSummary(employee)}</span>
            </div>
            {employee.tools.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {employee.tools.slice(0, 4).map((t) => (
                  <span
                    key={t.toolId}
                    className="rounded-md border border-border-2 bg-muted px-2 py-[3px] text-[11.5px] text-ink-2"
                  >
                    {t.name}
                  </span>
                ))}
                {employee.tools.length > 4 && (
                  <span className="px-1 py-[3px] text-[11.5px] text-ink-3">
                    +{employee.tools.length - 4}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        {onMessage && (
          <button
            type="button"
            onClick={() => onMessage(employee)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent-d"
          >
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
            Message
          </button>
        )}
        <Link
          href={`/workforce/${employee.id}`}
          className={cn(
            "flex items-center justify-center rounded-lg border border-border bg-surface py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-muted",
            onMessage ? "flex-1" : "w-full",
          )}
        >
          Profile
        </Link>
      </div>
    </div>
  );
}
