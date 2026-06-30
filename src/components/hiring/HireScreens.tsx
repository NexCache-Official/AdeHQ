"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { AiEmployeeApplicant, AiEmployeeJobBrief, RecruiterMessage } from "@/lib/hiring/types";
import { GEN_STEPS, INTERVIEW_QUESTIONS, MATCH_BARS } from "@/lib/hiring/data";
import { AdeOrb, MetricDots } from "./HireChrome";

export function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("");
}

export function ApplicantCard({
  applicant: a,
  advOpen,
  onToggleAdv,
  onInterview,
  onHire,
}: {
  applicant: AiEmployeeApplicant;
  advOpen: boolean;
  onToggleAdv: () => void;
  onInterview: () => void;
  onHire: () => void;
}) {
  return (
    <div
      className={cn(
        "relative rounded-[18px] border bg-surface p-5 transition hover:-translate-y-1 hover:shadow-xl",
        a.recommended
          ? "border-accent/40 shadow-[0_20px_44px_-28px_rgba(232,93,44,0.35)]"
          : "border-border",
      )}
    >
      {a.recommended && (
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-accent to-amber" />
      )}
      <div className="mb-3.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <AdeOrb grad={a.grad} size={46} initials={initials(a.name)} />
          <div>
            <div className="text-[17px] font-semibold tracking-tight">{a.name}</div>
            <div className="text-[13px] text-ink-2">{a.title}</div>
          </div>
        </div>
        <span
          className={cn(
            "whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold",
            a.badgeKind === "rec"
              ? "bg-gradient-to-br from-accent to-amber text-white"
              : "bg-muted text-ink-2",
          )}
        >
          {a.badge}
        </span>
      </div>
      {a.recommended && (
        <p className="mb-3 rounded-lg bg-accent-soft/50 px-3 py-2 text-[12.5px] leading-relaxed text-ink">
          {a.whyThisCandidate}
        </p>
      )}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {a.personalityTags.map((t) => (
          <span key={t} className="rounded-full bg-muted px-2.5 py-1 text-[11.5px] text-ink-2">
            {t}
          </span>
        ))}
      </div>
      <div className="mb-3.5 rounded-xl border border-border bg-muted/40 p-3.5">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Weekly AI Work Hours
          </span>
          <span className="text-[13px] text-ink-2">{a.engineLabel}</span>
        </div>
        <div className="mb-2 flex items-baseline gap-1.5">
          <span className="text-[26px] font-semibold tracking-tight">{a.weeklyWorkHours}</span>
          <span className="text-[13px] text-ink-2">hrs / week estimated</span>
        </div>
        <div className="h-[7px] overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-ink to-ink/60"
            style={{ width: `${Math.round(a.cap * 100)}%` }}
          />
        </div>
      </div>
      <div className="mb-4 space-y-2.5">
        {(
          [
            ["Quality", a.qualityLevel, a.quality],
            ["Speed", a.speedLevel, a.speed],
            ["Cost", a.costLevel, a.costIntensity],
          ] as const
        ).map(([label, level, text]) => (
          <div key={label} className="flex items-center gap-2.5">
            <span className="w-[46px] text-[12.5px] text-ink-2">{label}</span>
            <MetricDots level={level} />
            <span className="w-[74px] text-right text-[12.5px] font-medium capitalize">{text}</span>
          </div>
        ))}
      </div>
      <div className="mb-3">
        <div className="mb-1.5 text-[11.5px] font-semibold text-ink-3">Strengths</div>
        <ul className="space-y-1">
          {a.strengths.map((s) => (
            <li key={s} className="flex gap-2 text-[13px] leading-snug">
              <span className="text-green">+</span>
              {s}
            </li>
          ))}
        </ul>
      </div>
      <div className="mb-3.5">
        <div className="mb-1.5 text-[11.5px] font-semibold text-ink-3">Watch-outs</div>
        <ul className="space-y-1">
          {a.watchOuts.map((w) => (
            <li key={w} className="flex gap-2 text-[13px] leading-snug text-ink-2">
              <span className="text-ink/30">–</span>
              {w}
            </li>
          ))}
        </ul>
      </div>
      <div className="mb-3 rounded-[10px] bg-muted/50 px-3 py-2 text-[12.5px] text-ink-2">
        <span className="text-ink-3">Best for</span> · {a.bestFor}
      </div>
      <button
        type="button"
        onClick={onToggleAdv}
        className="flex w-full items-center justify-between border-t border-border pt-3 text-[12.5px] text-ink-3"
      >
        <span>Advanced engine details</span>
        <span className={cn("transition", advOpen && "rotate-180")}>⌄</span>
      </button>
      {advOpen && (
        <div className="mt-2.5 rounded-[10px] bg-ink p-3.5 font-mono text-xs">
          <div className="flex justify-between py-1 text-white/55">
            <span>Intelligence mode</span>
            <span className="text-white">{a.engineLabel}</span>
          </div>
          <div className="flex justify-between py-1 text-white/55">
            <span>Model mode</span>
            <span className="text-accent-soft">{a.modelMode}</span>
          </div>
          <div className="flex justify-between py-1 text-white/55">
            <span>Provider model</span>
            <span className="max-w-[55%] truncate text-right text-white/80">
              {a.resolvedModelId}
            </span>
          </div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onInterview}
          className="flex-1 rounded-[10px] border border-border py-2.5 text-sm transition hover:border-ink"
        >
          Interview
        </button>
        <button
          type="button"
          onClick={onHire}
          className="flex-1 rounded-[10px] bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/90"
        >
          Hire {a.first}
        </button>
      </div>
    </div>
  );
}

export function GeneratingScreen({ genStep }: { genStep: number }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas p-8">
      <div className="pointer-events-none absolute left-1/2 top-[32%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(232,93,44,0.12),transparent_62%)] blur-md" />
      <div className="relative mb-8 text-center">
        <div className="mx-auto mb-5 h-16 w-16 animate-spin rounded-[18px] bg-[conic-gradient(from_0deg,#e85d2c,#f59e0b,#e85d2c)] shadow-lg" />
        <h1 className="mb-2.5 text-[30px] font-semibold tracking-tight">
          Finding your best AI employee candidates
        </h1>
        <p className="mx-auto max-w-[480px] text-[14.5px] text-ink-2">
          Matching candidates based on role fit, work style, intelligence mode, and weekly capacity.
        </p>
      </div>
      <div className="relative grid w-full max-w-[760px] grid-cols-1 items-start gap-8 md:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-2.5">
          {GEN_STEPS.map((label, i) => {
            const done = i < genStep;
            const on = i === genStep;
            return (
              <div
                key={label}
                className="flex items-center gap-3"
                style={{ opacity: i <= genStep ? 1 : 0.32 }}
              >
                <div
                  className={cn(
                    "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    done && "bg-ink text-white",
                    on && "animate-spin border-2 border-ink/20 border-t-ink",
                    !done && !on && "border border-border",
                  )}
                >
                  {done ? "✓" : ""}
                </div>
                <span className={cn("text-[15px]", on ? "font-semibold" : "")}>{label}</span>
              </div>
            );
          })}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-[18px] shadow-md">
          <div className="mb-3.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Model matching
          </div>
          {MATCH_BARS.map((mb) => (
            <div key={mb.label} className="mb-3">
              <div className="mb-1 text-xs text-ink-2">{mb.label}</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-amber transition-all duration-1000"
                  style={{
                    width: `${genStep >= GEN_STEPS.length ? mb.w : Math.min(mb.w, genStep * 18)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function InterviewOverlay({
  applicant: a,
  messages,
  onClose,
  onHire,
  onAsk,
}: {
  applicant: AiEmployeeApplicant;
  messages: RecruiterMessage[];
  onClose: () => void;
  onHire: () => void;
  onAsk: (qid: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/45 p-6 backdrop-blur-sm">
      <div className="grid h-[78vh] w-full max-w-[960px] grid-cols-1 overflow-hidden rounded-[20px] bg-surface shadow-2xl md:grid-cols-[300px_1fr]">
        <div className="flex flex-col border-b border-border bg-muted/50 p-6 md:border-b-0 md:border-r">
          <AdeOrb grad={a.grad} size={60} initials={initials(a.name)} />
          <div className="mt-4 text-[19px] font-semibold tracking-tight">{a.name}</div>
          <div className="mb-3.5 text-[13px] text-ink-2">{a.title}</div>
          <p className="border-t border-border pt-3.5 text-[12.5px] leading-relaxed text-ink-3">
            {a.engineLabel} · estimated {a.weeklyWorkHours} hrs/week capacity
          </p>
          <div className="mt-auto flex flex-col gap-2 pt-6">
            <button type="button" onClick={onHire} className="rounded-[10px] bg-ink py-2.5 text-sm text-white">
              Hire {a.first}
            </button>
            <button type="button" onClick={onClose} className="rounded-[10px] border border-border py-2.5 text-sm">
              Back to applicants
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="border-b border-border px-5 py-4 text-[13px] text-ink-3">
            Interview · {a.name}
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "ade" ? "flex gap-2" : "flex justify-end"}>
                {m.role === "ade" && (
                  <AdeOrb grad={a.grad} size={40} initials={initials(a.name)} />
                )}
                <div
                  className={cn(
                    "max-w-[82%] whitespace-pre-line px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "ade"
                      ? "rounded-[4px_14px_14px_14px] border border-border bg-muted"
                      : "rounded-[14px_14px_4px_14px] bg-ink text-white",
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border bg-muted/50 p-4">
            {INTERVIEW_QUESTIONS.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => onAsk(q.id)}
                className="rounded-full border border-border bg-surface px-3 py-2 text-[12.5px] transition hover:border-ink"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function OfferScreen({
  applicant: a,
  brief,
  onBack,
  onConfirm,
}: {
  applicant: AiEmployeeApplicant;
  brief: AiEmployeeJobBrief;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-[720px]"
    >
      <div className="mb-6 text-center">
        <AdeOrb grad={a.grad} size={76} initials={initials(a.name)} />
        <h1 className="mt-4 text-[32px] font-semibold tracking-tight">Hire {a.name}?</h1>
        <p className="text-[15px] text-ink-2">Review the offer before adding them to your workforce.</p>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-md">
        {[
          { label: "Mission", value: brief.mission, serif: true },
          { label: "Personality", value: brief.personalityTraits.join(", ") },
          {
            label: "Weekly AI Work Capacity",
            value: `${a.weeklyWorkHours} AI Work Hours estimated`,
          },
          { label: "Approval rules", value: brief.approvalRules.join(" ") },
          { label: "Start location", value: "Direct Message (default)" },
          {
            label: "Engine",
            value: `${a.engineLabel} · ${a.modelMode} mode`,
            mono: true,
          },
        ].map((r) => (
          <div key={r.label} className="border-b border-border/60 py-4 last:border-none">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
              {r.label}
            </div>
            <p
              className={cn(
                "text-[14.5px] leading-relaxed",
                r.serif && "font-serif text-base italic",
                r.mono && "font-mono text-[13px]",
              )}
            >
              {r.value}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-2.5">
        <button type="button" onClick={onBack} className="flex-1 rounded-xl border border-border py-3 text-sm">
          Back to applicants
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 rounded-xl bg-ink py-3 text-sm font-medium text-white"
        >
          Confirm hire →
        </button>
      </div>
    </motion.div>
  );
}

export function AssignScreen({
  rooms,
  onAssignLater,
  onAssign,
}: {
  rooms: { id: string; name: string }[];
  onAssignLater: () => void;
  onAssign: (roomId: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-[520px] text-center"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Employee hired</h1>
      <p className="mt-2 text-[15px] text-ink-2">
        DM created and welcome message sent. Would you like to assign them to a room?
      </p>
      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={onAssignLater}
          className="w-full rounded-xl border border-border bg-surface py-3 text-sm font-medium"
        >
          Assign later → open DM
        </button>
        <div className="rounded-xl border border-border bg-surface p-4 text-left">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-ink-3">
            Add to channel
          </p>
          <div className="flex flex-wrap gap-2">
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onAssign(r.id)}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:border-ink"
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function SuccessScreen({
  applicant: a,
  successStep,
}: {
  applicant: AiEmployeeApplicant;
  successStep: number;
}) {
  const labels = [
    "Employee profile created",
    "Job brief saved",
    "DM created",
    "Welcome message sent",
    "Approval rules enabled",
    "Ready to collaborate",
  ];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-[520px] text-center"
    >
      <AdeOrb grad={a.grad} size={72} initials={initials(a.name)} />
      <h1 className="mt-5 text-[28px] font-semibold tracking-tight">{a.name} is on your team</h1>
      <p className="mt-2 text-[15px] text-ink-2">Setting up their profile and workspace access…</p>
      <div className="mt-8 text-left">
        {labels.map((label, i) => {
          const on = i < successStep;
          return (
            <div
              key={label}
              className="flex items-center gap-2.5 border-b border-border/50 py-2"
              style={{ opacity: on ? 1 : 0.4 }}
            >
              <div
                className={cn(
                  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  on ? "animate-[hirePop_0.3s_ease_both] bg-green text-white" : "border border-border",
                )}
              >
                {on ? "✓" : ""}
              </div>
              <span className="text-sm">{label}</span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
