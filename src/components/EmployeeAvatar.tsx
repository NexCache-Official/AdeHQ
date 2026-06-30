"use client";

import { AIEmployee, EmployeeStatus } from "@/lib/types";
import { cn, avatarGradient, initials } from "@/lib/utils";
import { STATUS_META } from "@/lib/icons";

const SIZES = {
  xs: { box: "h-[22px] w-[22px] rounded-[7px] text-[9px]", dot: "h-2 w-2 border-2" },
  sm: { box: "h-[30px] w-[30px] rounded-[9px] text-[11px]", dot: "h-2.5 w-2.5 border-2" },
  md: { box: "h-[38px] w-[38px] rounded-[11px] text-[13px]", dot: "h-2.5 w-2.5 border-2" },
  lg: { box: "h-[46px] w-[46px] rounded-[14px] text-base", dot: "h-3 w-3 border-[3px]" },
  xl: { box: "h-[72px] w-[72px] rounded-[20px] text-[26px]", dot: "h-4 w-4 border-[3px]" },
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
  const status: EmployeeStatus = employee.status;
  const meta = STATUS_META[status];

  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "flex items-center justify-center font-bold text-white",
          s.box,
        )}
        style={{ backgroundImage: avatarGradient(employee.accent) }}
      >
        {initials(employee.name)}
      </div>
      {showStatus && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full border-surface",
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
  accent = "#3B4C6B",
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
        "flex shrink-0 items-center justify-center font-bold text-white",
        s.box,
        className,
      )}
      style={{ backgroundImage: avatarGradient(accent) }}
    >
      {initials(name)}
    </div>
  );
}

/** Muted square icon container for channels (prototype style). */
export function ChannelIcon({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-muted text-ink-2",
        className,
      )}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16" />
      </svg>
    </div>
  );
}
