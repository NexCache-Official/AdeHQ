"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Sparkles,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui";
import { AdeOrb } from "@/components/hiring/HireChrome";
import { MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import { callCandidates } from "@/lib/hiring/hiring-api";
import type { AiEmployeeApplicant } from "@/lib/hiring/types";
import type { WorkforceBlueprintPayload, WorkforceSeat } from "@/lib/hiring/workforce-studio/types";
import {
  bandsBySeatId,
  humanMappingReason,
  seatToJobBrief,
} from "@/lib/hiring/workforce-studio/seat-brief";
import { cn } from "@/lib/utils";

export function TeamReveal({
  payload,
  designReasons,
  expectedWeeklyWhLow,
  expectedWeeklyWhHigh,
  mappingReason,
  assumptions,
  workspaceId,
  onOpenStudio,
  onApplySeatInclusion,
  onSelectCandidate,
}: {
  payload: WorkforceBlueprintPayload;
  designReasons: string[];
  expectedWeeklyWhLow: number;
  expectedWeeklyWhHigh: number;
  mappingReason?: string;
  assumptions?: Array<{ statement: string }>;
  workspaceId: string;
  onOpenStudio: (includedSeatIds: string[]) => void;
  onApplySeatInclusion?: (includedSeatIds: string[]) => void;
  onSelectCandidate?: (seatId: string, candidate: AiEmployeeApplicant) => void;
}) {
  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(payload.seats.map((s) => s.id)),
  );
  const [expanded, setExpanded] = useState<string | null>(payload.seats[0]?.id ?? null);
  const [candidatesBySeat, setCandidatesBySeat] = useState<Record<string, AiEmployeeApplicant[]>>(
    {},
  );
  const [selectedCandidate, setSelectedCandidate] = useState<Record<string, string>>({});
  const [loadingSeat, setLoadingSeat] = useState<string | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);

  const bands = useMemo(() => bandsBySeatId(payload.seats), [payload.seats]);
  const friendlyMapping = humanMappingReason(mappingReason);
  const includedCount = included.size;

  function toggleSeat(seatId: string) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(seatId)) {
        if (next.size <= 1) return prev;
        next.delete(seatId);
      } else {
        next.add(seatId);
      }
      onApplySeatInclusion?.([...next]);
      return next;
    });
  }

  async function generateForSeat(seat: WorkforceSeat) {
    setLoadingSeat(seat.id);
    setCandidateError(null);
    setExpanded(seat.id);
    try {
      const brief = seatToJobBrief(seat);
      const result = await callCandidates(brief, null, seat.roleKey, {
        workspaceId,
      });
      setCandidatesBySeat((prev) => ({ ...prev, [seat.id]: result.candidates }));
    } catch (err) {
      setCandidateError(
        err instanceof Error ? err.message : "Could not generate candidates for this seat.",
      );
    } finally {
      setLoadingSeat(null);
    }
  }

  function pickCandidate(seat: WorkforceSeat, candidate: AiEmployeeApplicant) {
    setSelectedCandidate((prev) => ({ ...prev, [seat.id]: candidate.id }));
    onSelectCandidate?.(seat.id, candidate);
  }

  return (
    <div className="studio-fade-up mx-auto max-w-3xl space-y-8">
      <div className="flex items-start gap-3">
        <AdeOrb size={40} initials="M" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
            {MAYA_EMPLOYEE_NAME}
          </p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-ink">
            I designed a {payload.seats.length}-person workforce for your business.
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">
            Review each role brief below. You can drop seats you don&apos;t need, preview
            candidates, then open Studio to simulate a week before anything is hired.
          </p>
          {friendlyMapping ? (
            <p className="mt-2 text-[12px] text-ink-3">{friendlyMapping}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        {payload.seats.map((seat) => {
          const band = bands.get(seat.id);
          const isOn = included.has(seat.id);
          const isOpen = expanded === seat.id;
          const candidates = candidatesBySeat[seat.id] ?? [];
          return (
            <div
              key={seat.id}
              className={cn(
                "rounded-2xl border bg-surface transition",
                isOn ? "border-border" : "border-border/60 opacity-60",
              )}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggleSeat(seat.id)}
                  className="mt-1.5 h-4 w-4 accent-ink"
                  aria-label={`Include ${seat.roleTitle}`}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setExpanded(isOpen ? null : seat.id)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[15px] font-semibold text-ink">{seat.roleTitle}</p>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-ink-3">
                      {seat.seniority}
                    </span>
                    {seat.preferredCandidateName ? (
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-ink">
                        {seat.preferredCandidateName}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{seat.mission}</p>
                  {band ? (
                    <p className="mt-1.5 text-[11px] text-ink-3">
                      Est. weekly capacity {band.lowWh}–{band.highWh} WH (seniority + authority
                      heuristic)
                    </p>
                  ) : null}
                </button>
              </div>

              {isOpen ? (
                <div className="space-y-3 border-t border-border px-4 py-3 pl-11">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
                      Responsibilities
                    </p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] text-ink-2">
                      {seat.responsibilities.slice(0, 5).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                  {seat.successMetrics.length ? (
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
                        Success metrics
                      </p>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] text-ink-2">
                        {seat.successMetrics.slice(0, 4).map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isOn || loadingSeat === seat.id}
                      onClick={() => void generateForSeat(seat)}
                    >
                      {loadingSeat === seat.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {candidates.length ? "Regenerate candidates" : "Generate candidates"}
                    </Button>
                    <span className="text-[11px] text-ink-3">
                      Optional — helps you picture who fills the seat. Hire still uses the role brief.
                    </span>
                  </div>

                  {candidates.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-3">
                      {candidates.map((c) => {
                        const picked = selectedCandidate[seat.id] === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            disabled={!isOn}
                            onClick={() => pickCandidate(seat, c)}
                            className={cn(
                              "rounded-xl border px-3 py-3 text-left transition",
                              picked
                                ? "border-accent bg-accent/10"
                                : "border-border bg-canvas hover:border-accent/40",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <AdeOrb size={28} initials={c.first} grad={c.grad} />
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-medium text-ink">{c.name}</p>
                                <p className="truncate text-[11px] text-ink-3">{c.operatingStyle}</p>
                              </div>
                              {picked ? <Check className="ml-auto h-3.5 w-3.5 text-accent" /> : null}
                            </div>
                            <p className="mt-2 line-clamp-3 text-[11px] text-ink-2">
                              {c.bestFor || c.whyThisCandidate || c.title}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {candidateError ? (
        <p className="text-[13px] text-danger">{candidateError}</p>
      ) : null}

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
            Estimated weekly capacity
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
            {expectedWeeklyWhLow}–{expectedWeeklyWhHigh}{" "}
            <span className="text-base font-medium text-ink-3">WH</span>
          </p>
          <p className="mt-2 text-[13px] text-ink-2">
            Forecast band from seniority and authority — not a live meter. Light weeks trend low;
            busy weeks approach the high end. Ask {MAYA_EMPLOYEE_NAME} to lean the team in Studio.
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

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => onOpenStudio([...included])}
          disabled={includedCount === 0}
          className="h-11 px-5"
        >
          Open Workforce Studio with {includedCount} seat{includedCount === 1 ? "" : "s"}
          <ArrowRight className="h-4 w-4" />
        </Button>
        <p className="text-[12px] text-ink-3">
          Next: simulate coverage and permissions, then approve &amp; hire.
        </p>
      </div>
    </div>
  );
}
