"use client";

import { EmployeeStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<
  EmployeeStatus,
  { label: string; color: string; soft: string; dot: string }
> = {
  idle: { label: "Idle", color: "#9B968B", soft: "#F0EDE6", dot: "bg-ink-3" },
  working: { label: "Working", color: "#E85D2C", soft: "#FBE9DE", dot: "bg-accent" },
  waiting_approval: {
    label: "Waiting for approval",
    color: "#CB8A1B",
    soft: "#FBEFD6",
    dot: "bg-amber",
  },
  on_call: { label: "On call", color: "#2F6FED", soft: "#E5EDFD", dot: "bg-info" },
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
        "inline-flex items-center gap-1.5 rounded-[8px] font-semibold",
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[11.5px]",
        className,
      )}
      style={{ color: meta.color, background: meta.soft }}
    >
      <span
        className={cn(
          "rounded-full",
          compact ? "h-2 w-2" : "h-2 w-2",
          meta.dot,
          status === "working" && "animate-pulse-ring",
        )}
      />
      {meta.label}
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
        status === "working" && "animate-pulse-ring",
        className,
      )}
    />
  );
}
