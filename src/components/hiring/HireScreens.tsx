"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { AiEmployeeApplicant, AiEmployeeJobBrief, RecruiterMessage } from "@/lib/hiring/types";
import { GEN_STEPS, INTERVIEW_QUESTIONS, MATCH_BARS } from "@/lib/hiring/data";
import {
  candidateOneLineSummary,
  limitBullets,
} from "@/lib/hiring/candidate-display";
import {
  CONTEXT_PROFILE_LABELS,
  displayEngineModel,
  RUNTIME_MODE_LABELS,
} from "@/lib/hiring/intelligence-labels";
import {
  buildIntelligencePolicyForHire,
  formatIntelligencePolicyLines,
} from "@/lib/ai/intelligence-policy";
import { MAYA_INTELLIGENCE_ROUTING_COPY } from "@/lib/hiring/maya";
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
  hireDisabled = false,
}: {
  applicant: AiEmployeeApplicant;
  advOpen: boolean;
  onToggleAdv: () => void;
  onInterview: () => void;
  onHire: () => void;
  hireDisabled?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const summary = candidateOneLineSummary(a);
  const workStyle = limitBullets(a.howIWork ?? [], 3);
  const strengths = limitBullets(a.strengths, 3);
  const watchOuts = limitBullets(a.watchOuts, 2);
  const traits = limitBullets(a.personalityTags, 4);
  const aiSetup = formatIntelligencePolicyLines(
    buildIntelligencePolicyForHire({ modelMode: a.modelMode }),
  );

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-[18px] border bg-surface p-5 transition hover:-translate-y-1 hover:shadow-xl",
        a.recommended
          ? "border-accent/40 shadow-[0_20px_44px_-28px_rgba(47,111,237,0.35)]"
          : "border-border",
      )}
    >
      {a.recommended && (
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-accent to-amber" />
      )}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <AdeOrb grad={a.grad} size={46} initials={initials(a.name)} />
          <div className="min-w-0">
            <div className="text-[17px] font-semibold tracking-tight">{a.name}</div>
            <div className="text-[13px] text-ink-2">{a.title}</div>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold",
            a.badgeKind === "rec"
              ? "bg-gradient-to-br from-accent to-amber text-white"
              : "bg-muted text-ink-2",
          )}
        >
          {a.badge}
        </span>
      </div>

      <p className="mb-3 text-[13.5px] leading-snug text-ink-2">{summary}</p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {traits.map((t) => (
          <span key={t} className="rounded-full bg-muted px-2.5 py-1 text-[11.5px] capitalize text-ink-2">
            {t}
          </span>
        ))}
      </div>

      <div className="mb-3.5 space-y-2">
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

      <div className="mb-3.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Weekly capacity
          </span>
          <span className="text-[12.5px] text-ink-2">{a.engineLabel}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[22px] font-semibold tracking-tight">{a.weeklyWorkHours}</span>
          <span className="text-[12.5px] text-ink-2">hrs / week</span>
        </div>
        <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-ink to-ink/60"
            style={{ width: `${Math.round(a.cap * 100)}%` }}
          />
        </div>
      </div>

      <p className="mb-3.5 text-[12.5px] leading-snug text-ink-2">
        <span className="font-medium text-ink-3">Best for</span> · {a.bestFor}
      </p>

      <button
        type="button"
        onClick={() => setDetailsOpen((open) => !open)}
        className="flex w-full items-center justify-between border-t border-border pt-3 text-[12.5px] font-medium text-ink-2"
      >
        <span>More details</span>
        <span className={cn("text-ink-3 transition", detailsOpen && "rotate-180")}>⌄</span>
      </button>
      {detailsOpen && (
        <div className="mt-3 space-y-3.5 border-b border-border pb-3.5">
          {workStyle.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Work style
              </div>
              <ul className="space-y-1">
                {workStyle.map((line) => (
                  <li key={line} className="flex gap-2 text-[13px] leading-snug text-ink-2">
                    <span className="text-accent">•</span>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {strengths.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Strengths
              </div>
              <ul className="space-y-1">
                {strengths.map((s) => (
                  <li key={s} className="flex gap-2 text-[13px] leading-snug text-ink-2">
                    <span className="text-green">+</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {watchOuts.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Watch-outs
              </div>
              <ul className="space-y-1">
                {watchOuts.map((w) => (
                  <li key={w} className="flex gap-2 text-[13px] leading-snug text-ink-2">
                    <span className="text-ink/30">–</span>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {aiSetup.length > 0 && (
            <div className="rounded-[10px] bg-muted/40 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                AI setup
              </div>
              <div className="space-y-1.5">
                {aiSetup.map((line) => (
                  <div key={line.label} className="flex justify-between gap-3 text-[12.5px]">
                    <span className="text-ink-3">{line.label}</span>
                    <span className="text-right text-ink-2">{line.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onToggleAdv}
        className="flex w-full items-center justify-between pt-3 text-[12.5px] text-ink-3"
      >
        <span>Advanced details</span>
        <span className={cn("transition", advOpen && "rotate-180")}>⌄</span>
      </button>
      {advOpen && (
        <div className="mt-2.5 rounded-[10px] bg-ink p-3.5 font-mono text-xs">
          <div className="flex justify-between py-1 text-white/55">
            <span>Last resolved model</span>
            <span className="max-w-[55%] truncate text-right text-white/80">
              {displayEngineModel(a.resolvedModelId)}
            </span>
          </div>
          <div className="flex justify-between py-1 text-white/55">
            <span>Provider route</span>
            <span className="text-white/80">Auto (shadow estimate)</span>
          </div>
          <div className="flex justify-between py-1 text-white/55">
            <span>Runtime mode</span>
            <span className="text-accent-soft">{RUNTIME_MODE_LABELS[a.modelMode]}</span>
          </div>
          <div className="flex justify-between py-1 text-white/55">
            <span>Fallback candidate</span>
            <span className="text-white/80">Balanced upgrade path</span>
          </div>
          <div className="flex justify-between py-1 text-white/55">
            <span>Context profile</span>
            <span className="text-white/80">{CONTEXT_PROFILE_LABELS[a.modelMode]}</span>
          </div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onInterview}
          disabled={hireDisabled}
          className="flex-1 rounded-[10px] border border-border py-2.5 text-sm transition hover:border-ink disabled:opacity-50"
        >
          Interview
        </button>
        <button
          type="button"
          onClick={onHire}
          disabled={hireDisabled}
          className="flex-1 rounded-[10px] bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/90 disabled:opacity-50"
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
      <div className="pointer-events-none absolute left-1/2 top-[32%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(47,111,237,0.12),transparent_62%)] blur-md" />
      <div className="relative mb-8 text-center">
        <div className="mx-auto mb-5 h-16 w-16 animate-spin rounded-[18px] bg-[conic-gradient(from_0deg,#2f6fed,#5fa0ff,#2f6fed)] shadow-lg" />
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
  busy = false,
  onClose,
  onHire,
  onAsk,
}: {
  applicant: AiEmployeeApplicant;
  messages: RecruiterMessage[];
  busy?: boolean;
  onClose: () => void;
  onHire: () => void;
  onAsk: (question: string) => void;
}) {
  const [input, setInput] = useState("");

  const submitQuestion = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    onAsk(trimmed);
  };

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
                    m.isOptimistic && "animate-pulse text-ink-3",
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
                disabled={busy}
                onClick={() => submitQuestion(q.label)}
                className="rounded-full border border-border bg-surface px-3 py-2 text-[12.5px] transition hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {q.label}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2 border-t border-border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitQuestion(input);
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={busy}
              placeholder={busy ? `${a.first} is thinking…` : "Ask your own question…"}
              className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-ink disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </form>
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
          {
            label: "Personality",
            value: [
              a.personalityTags.join(", "),
              a.communicationStyle ? `Communication: ${a.communicationStyle}` : "",
              a.autonomyLevel ? `Autonomy: ${a.autonomyLevel}` : "",
              a.proactivityLevel ? `Proactivity: ${a.proactivityLevel}` : "",
            ]
              .filter(Boolean)
              .join(" · "),
          },
          {
            label: "Weekly capacity",
            value: `${a.weeklyWorkHours} hrs / week estimated`,
          },
          ...formatIntelligencePolicyLines(
            buildIntelligencePolicyForHire({ modelMode: a.modelMode }),
          ).map((line) => ({ label: line.label, value: line.value })),
          { label: "Approval rules", value: brief.approvalRules.join(" · ") || "Ask before high-risk actions" },
          { label: "Start location", value: "Direct Message (default)" },
          {
            label: "Maya note",
            value: MAYA_INTELLIGENCE_ROUTING_COPY,
          },
        ].map((r) => (
          <div key={r.label} className="border-b border-border/60 py-4 last:border-none">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
              {r.label}
            </div>
            <p
              className={cn(
                "text-[14.5px] leading-relaxed",
                "serif" in r && r.serif && "font-serif text-base italic",
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
            Add to room
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
