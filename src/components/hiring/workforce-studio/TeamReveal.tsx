"use client";

import { ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";
import type { WorkforceBlueprintPayload } from "@/lib/hiring/workforce-studio/types";

export function TeamReveal({
  payload,
  designReasons,
  expectedWeeklyWhLow,
  expectedWeeklyWhHigh,
  mappingReason,
  assumptions,
  onOpenStudio,
}: {
  payload: WorkforceBlueprintPayload;
  designReasons: string[];
  expectedWeeklyWhLow: number;
  expectedWeeklyWhHigh: number;
  mappingReason?: string;
  assumptions?: Array<{ statement: string }>;
  onOpenStudio: () => void;
}) {
  const departments = [...new Set(payload.rooms.map((r) => r.name))];

  return (
    <div className="studio-fade-up mx-auto max-w-3xl space-y-8">
      <div>
        <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Maya</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-ink">
          I designed a {payload.seats.length}-person workforce for your business.
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">
          This team covers {departments.slice(0, 3).join(", ")}
          {departments.length > 3 ? ", and more" : ""}, while keeping high-risk external actions
          under your approval. Review the design, simulate a week, then approve when you&apos;re
          ready — nothing is hired yet.
        </p>
        {mappingReason ? (
          <p className="mt-2 text-[12px] text-ink-3">{mappingReason}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        {payload.seats.map((seat) => (
          <div
            key={seat.id}
            className="flex min-w-[140px] flex-1 items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-3"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-[12px] font-semibold text-accent">
              {seat.roleTitle
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{seat.roleTitle}</p>
              <p className="truncate text-[11px] text-ink-3 capitalize">{seat.seniority}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface px-5 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
            Why this design
          </p>
          <ul className="mt-3 space-y-2">
            {designReasons.slice(0, 3).map((reason) => (
              <li key={reason} className="flex gap-2 text-[13px] text-ink-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-surface px-5 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
            Expected weekly capacity
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
            {expectedWeeklyWhLow}–{expectedWeeklyWhHigh}{" "}
            <span className="text-base font-medium text-ink-3">WH</span>
          </p>
          <p className="mt-2 text-[13px] text-ink-2">
            Light weeks trend near the low end; busy weeks may approach the high end. You can ask
            Maya to make the team leaner in Studio.
          </p>
          {assumptions && assumptions.length > 0 ? (
            <div className="mt-4 rounded-xl border border-amber/30 bg-amber/10 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink">
                <AlertTriangle className="h-3.5 w-3.5" /> Assumptions to confirm
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-ink-2">
                {assumptions.slice(0, 2).map((a) => (
                  <li key={a.statement}>{a.statement}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
          Outcomes this team owns
        </p>
        <ul className="mt-2 space-y-1.5">
          {payload.outcomes.slice(0, 4).map((outcome) => (
            <li key={outcome.id} className="text-[13px] text-ink-2">
              <span className="font-medium text-ink">{outcome.title}</span>
              {outcome.metric ? ` · ${outcome.metric}` : ""}
              {outcome.target ? ` → ${outcome.target}` : ""}
            </li>
          ))}
        </ul>
      </div>

      <Button onClick={onOpenStudio} className="h-11 px-5">
        Open Workforce Studio
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
