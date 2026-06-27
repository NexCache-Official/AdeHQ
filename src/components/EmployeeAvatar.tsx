"use client";

import { AIEmployee, EmployeeStatus } from "@/lib/types";
import { cn, avatarGradient, initials } from "@/lib/utils";
import { roleIcon, STATUS_META } from "@/lib/icons";

const SIZES = {
  xs: { box: "h-7 w-7", icon: "h-3.5 w-3.5", dot: "h-2 w-2", text: "text-[10px]" },
  sm: { box: "h-9 w-9", icon: "h-4 w-4", dot: "h-2.5 w-2.5", text: "text-xs" },
  md: { box: "h-11 w-11", icon: "h-5 w-5", dot: "h-3 w-3", text: "text-sm" },
  lg: { box: "h-14 w-14", icon: "h-6 w-6", dot: "h-3.5 w-3.5", text: "text-base" },
  xl: { box: "h-20 w-20", icon: "h-9 w-9", dot: "h-4 w-4", text: "text-2xl" },
};

export function EmployeeAvatar({
  employee,
  size = "md",
  showStatus = true,
  className,
}: {
  employee: Pick<AIEmployee, "name" | "accent" | "roleKey" | "status">;
  size?: keyof typeof SIZES;
  showStatus?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  const Icon = roleIcon(employee.roleKey);
  const status: EmployeeStatus = employee.status;
  const meta = STATUS_META[status];

  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl text-white shadow-glow-sm ring-1 ring-white/20",
          s.box,
        )}
        style={{ backgroundImage: avatarGradient(employee.accent) }}
      >
        <Icon className={s.icon} strokeWidth={2} />
      </div>
      {showStatus && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white",
            s.dot,
            meta.dot,
            status === "working" && "animate-pulse-ring",
          )}
        />
      )}
    </div>
  );
}

export function HumanAvatar({
  name,
  size = "md",
  accent = "#f97316",
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  accent?: string;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-2xl font-semibold text-white ring-1 ring-white/20",
        s.box,
        s.text,
        className,
      )}
      style={{ backgroundImage: avatarGradient(accent) }}
    >
      {initials(name)}
    </div>
  );
}
