"use client";

import { EmployeeStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<
  EmployeeStatus,
  { label: string; color: string; soft: string; dot: string }
> = {
  online: { label: "Online", color: "#2b7440", soft: "#e1f5e4", dot: "bg-green" },
  idle: { label: "Idle", color: "#66625e", soft: "#f3f1ef", dot: "bg-ink-3" },
  working: { label: "Working", color: "#2b7440", soft: "#e1f5e4", dot: "bg-green" },
  waiting_approval: {
    label: "Waiting for approval",
    color: "#a45e00",
    soft: "#ffeccd",
    dot: "bg-amber",
  },
  on_call: { label: "On call", color: "#414f5d", soft: "#f1f0ee", dot: "bg-info" },
  offline: {
    label: "Offline — Work Hours used up",
    color: "#66625e",
    soft: "#f3f1ef",
    dot: "bg-ink-3",
  },
  blocked: { label: "Blocked", color: "#D9483B", soft: "#FBE3E0", dot: "bg-danger" },
};

export function EmployeeStatusBadge({
  status,
  className,
  compact,
}: {
  status: EmployeeStatus;
  className?: string;
  compact?: boolean;
}) {
  const meta = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-[8px] font-semibold",
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[11.5px]",
        className,
      )}
      style={{ color: meta.color, background: meta.soft }}
      title={meta.label}
    >
      <span
        className={cn(
          "shrink-0 rounded-full",
          compact ? "h-2 w-2" : "h-2 w-2",
          meta.dot,
          (status === "working" || status === "online") && "animate-pulse-ring",
        )}
      />
      <span className="min-w-0 truncate">{meta.label}</span>
    </span>
  );
}

export function EmployeeStatusDot({
  status,
  className,
}: {
  status: EmployeeStatus;
  className?: string;
}) {
  const meta = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        meta.dot,
        (status === "working" || status === "online") && "animate-pulse-ring",
        className,
      )}
    />
  );
}
