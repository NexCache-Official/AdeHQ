"use client";

import { EmployeeStatus } from "@/lib/types";
import { STATUS_META } from "@/lib/icons";
import { cn } from "@/lib/utils";

export function EmployeeStatusBadge({
  status,
  className,
}: {
  status: EmployeeStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        meta.text,
        meta.ring,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot, status === "working" && "animate-pulse-ring")} />
      {meta.label}
    </span>
  );
}
