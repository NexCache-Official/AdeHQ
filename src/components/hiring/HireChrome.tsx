"use client";

import { cn } from "@/lib/utils";

export function HireHeader() {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-canvas/85 px-6 py-3.5 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-ink text-sm font-bold text-white">
          A
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-tight text-ink">AdeHQ</span>
          <span className="text-ink-3">/</span>
          <span className="text-sm text-ink-2">Hire an AI employee</span>
        </div>
      </div>
      <div className="flex items-center gap-2.5 rounded-full border border-border bg-surface py-1.5 pl-1.5 pr-3">
        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-emerald-400 to-sky-500 shadow-[0_0_0_3px_rgba(14,165,233,0.12)]" />
        <span className="text-[13px] font-medium text-ink-2">Ade Recruiter</span>
        <span className="h-[7px] w-[7px] rounded-full bg-green shadow-[0_0_0_3px_rgba(27,166,114,0.18)]" />
      </div>
    </header>
  );
}

export function HireStepper({
  screen,
  recruiterTurns,
}: {
  screen: string;
  recruiterTurns: number;
}) {
  const labels = ["Role", "Context", "Style", "Job Brief", "Applicants"];
  let active = 0;
  if (screen === "landing") active = 0;
  else if (screen === "recruiter") active = Math.min(1 + Math.floor(recruiterTurns / 2), 2);
  else if (screen === "brief") active = 3;
  else active = 4;

  if (screen === "generating" || screen === "offer" || screen === "success" || screen === "profile") {
    return null;
  }

  return (
    <div className="flex justify-center px-5 pb-1 pt-[18px]">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {labels.map((label, i) => {
          const done = i < active;
          const on = i === active;
          return (
            <div key={label} className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-semibold",
                  done || on ? "bg-ink text-white" : "bg-muted text-ink-3",
                )}
              >
                {done ? "✓" : i + 1}
              </div>
              <span
                className={cn(
                  "text-[12.5px]",
                  on ? "font-semibold text-ink" : done ? "text-ink-2" : "text-ink-3",
                )}
              >
                {label}
              </span>
              {i < labels.length - 1 && (
                <div className="mx-1 h-px w-[26px] bg-border" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdeOrb({ grad, size = 32, initials }: { grad?: string; size?: number; initials?: string }) {
  return (
    <div
      className="relative flex shrink-0 items-center justify-center font-semibold text-white shadow-[0_6px_18px_-6px_rgba(34,31,26,0.4),inset_0_1px_1px_rgba(255,255,255,0.3)]"
      style={{
        width: size,
        height: size,
        borderRadius: size >= 64 ? 20 : 9999,
        background: grad ?? "linear-gradient(135deg,#34d399,#0ea5e9)",
        fontSize: size >= 60 ? 21 : size >= 40 ? 14 : 12,
      }}
    >
      {initials && <span className="relative z-[1]">{initials}</span>}
    </div>
  );
}

export function MetricDots({ level }: { level: number }) {
  return (
    <div className="flex flex-1 gap-1">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            "h-[5px] flex-1 rounded-sm",
            i <= level ? "bg-ink" : "bg-ink/10",
          )}
        />
      ))}
    </div>
  );
}
