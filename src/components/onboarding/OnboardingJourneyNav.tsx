"use client";

import { cn } from "@/lib/utils";

export type JourneyStep = {
  label: string;
  value: string;
  status: "done" | "current" | "todo";
  onGo?: () => void;
};

type OnboardingJourneyNavProps = {
  steps: JourneyStep[];
  progressLinePct: number;
};

export function OnboardingJourneyNav({ steps, progressLinePct }: OnboardingJourneyNavProps) {
  return (
    <nav className="relative z-[2] pt-0.5">
      <div className="mb-2.5 ml-[39px] font-mono text-[9.5px] uppercase tracking-[0.09em] text-white/40">
        Your setup
      </div>
      <div className="relative">
        <div className="absolute bottom-[11px] left-[13px] top-[11px] w-0.5 rounded-sm bg-white/12" />
        <div
          className="absolute left-[13px] top-[11px] w-0.5 rounded-sm bg-gradient-to-b from-[var(--accent)] to-[#F2974E] transition-[height] duration-500 ease-out"
          style={{ height: `${progressLinePct}%` }}
        />
        <div className="flex flex-col gap-px">
          {steps.map((step, i) => {
            const clickable = step.status === "done" && step.onGo;
            const active = step.status !== "todo";
            return (
              <button
                key={step.label}
                type="button"
                disabled={!clickable}
                onClick={clickable ? step.onGo : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[10px] border-0 bg-transparent px-1.5 py-1.5 text-left transition-colors",
                  clickable && "cursor-pointer hover:bg-white/[0.06]",
                  !clickable && "cursor-default",
                )}
              >
                <div
                  className={cn(
                    "z-[1] flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold transition-all duration-300",
                    step.status === "done" &&
                      "bg-[var(--accent)] text-white shadow-[0_4px_12px_-4px_color-mix(in_srgb,var(--accent)_80%,transparent)]",
                    step.status === "current" &&
                      "bg-white text-[var(--accent-d)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_35%,transparent)]",
                    step.status === "todo" && "bg-white/[0.09] text-white/40",
                  )}
                >
                  {step.status === "done" ? "✓" : i + 1}
                </div>
                <div className="flex min-w-0 flex-col items-start gap-0">
                  <span
                    className={cn(
                      "whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.05em]",
                      active ? "text-white/50" : "text-white/30",
                    )}
                  >
                    {step.label}
                  </span>
                  <span
                    className={cn(
                      "max-w-[230px] truncate text-[13.5px] font-semibold leading-snug",
                      active ? "text-white" : "text-white/40",
                    )}
                  >
                    {step.value}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
