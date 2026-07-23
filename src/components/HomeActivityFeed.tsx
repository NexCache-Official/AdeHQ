"use client";

import { WorkLogEvent } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { cn, timeAgo } from "@/lib/utils";
import {
  formatWorkLogEntryDisplay,
  shouldShowWorkLogInSidebar,
  workLogCanJump,
  type WorkLogFilterOptions,
} from "@/lib/work-log-labels";
import { jumpFromWorkLog } from "@/lib/navigation/jump-to-source";
import { CheckCircle2, Clock, ShieldAlert, XCircle } from "lucide-react";

const STATUS_META = {
  success: {
    icon: CheckCircle2,
    label: "SUCCESS",
    className: "bg-green-soft text-green",
    iconClass: "text-green",
  },
  pending: {
    icon: Clock,
    label: "PENDING",
    className: "bg-muted text-ink-3",
    iconClass: "text-ink-3",
  },
  failed: {
    icon: XCircle,
    label: "FAILED",
    className: "bg-danger-soft text-danger",
    iconClass: "text-danger",
  },
  needs_approval: {
    icon: ShieldAlert,
    label: "NEEDS APPROVAL",
    className: "bg-amber-soft text-amber",
    iconClass: "text-amber",
  },
};

/** Home.dc.html-styled activity list (avatar + title + SUCCESS pill + time). */
export function HomeActivityFeed({
  events,
  debugEnabled = false,
}: {
  events: WorkLogEvent[];
  debugEnabled?: boolean;
}) {
  const { state } = useStore();
  const filterOpts: WorkLogFilterOptions = { debugEnabled };
  const items = events.filter((event) =>
    shouldShowWorkLogInSidebar(event.action, event.summary, filterOpts),
  );

  if (items.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-border bg-surface px-5 py-8 text-center text-sm text-ink-3">
        No activity yet today.
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-border bg-surface px-[18px] pb-2 pt-0.5">
      {items.map((event) => {
        const employee = state.employees.find((e) => e.id === event.employeeId);
        const status = STATUS_META[event.status];
        const StatusIcon = status.icon;
        const canJump = workLogCanJump(event);
        const { title, summaryLine } = formatWorkLogEntryDisplay(
          employee?.name,
          event.action,
          event.summary,
        );

        const handleJump = () => {
          if (canJump) jumpFromWorkLog(event);
        };

        return (
          <div
            key={event.id}
            role={canJump ? "button" : undefined}
            tabIndex={canJump ? 0 : undefined}
            onClick={canJump ? handleJump : undefined}
            onKeyDown={
              canJump
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleJump();
                    }
                  }
                : undefined
            }
            className={cn(
              "flex gap-3 border-t border-border-2 py-[15px] first:border-t-0",
              canJump && "cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/15",
            )}
          >
            {employee ? (
              <EmployeeAvatar employee={employee} size="sm" showStatus={false} />
            ) : (
              <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-muted text-[10.5px] font-semibold text-ink-3">
                AI
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{title}</div>
              {summaryLine ? (
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{summaryLine}</p>
              ) : null}
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium tracking-[0.04em]",
                    status.className,
                  )}
                >
                  <StatusIcon className={cn("h-3 w-3", status.iconClass)} strokeWidth={2.4} />
                  {status.label}
                </span>
                <span className="font-mono text-[11.5px] text-ink-3">{timeAgo(event.createdAt)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
