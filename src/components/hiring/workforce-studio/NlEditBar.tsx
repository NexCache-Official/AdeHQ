"use client";

import { useState, type ReactNode } from "react";
import { Sparkles, Loader2, Check, X, Plus, Minus, Pencil, Target } from "lucide-react";
import { Button, Card } from "@/components/ui";
import type { NlEditDiffOp, NlEditProposal } from "@/lib/hiring/workforce-studio/nl-edit-apply";
import type { GoalOpImpactSummary } from "@/lib/hiring/workforce-studio/client-api";
import { GOAL_OP_LABELS, type GoalOpId } from "@/lib/hiring/workforce-studio/goal-ops";

const OP_ICON: Record<NlEditDiffOp["kind"], ReactNode> = {
  add_seat: <Plus className="h-3.5 w-3.5 text-green" />,
  remove_seat: <Minus className="h-3.5 w-3.5 text-danger" />,
  update_seat: <Pencil className="h-3.5 w-3.5 text-accent" />,
  add_outcome: <Target className="h-3.5 w-3.5 text-green" />,
};

function opLabel(op: NlEditDiffOp): string {
  switch (op.kind) {
    case "add_seat":
      return `Add seat: ${op.roleTitle}`;
    case "remove_seat":
      return `Remove seat: ${op.roleTitle}`;
    case "update_seat":
      return `Update ${op.roleTitle}: ${op.fields.join(", ")}`;
    case "add_outcome":
      return `Add outcome: ${op.title}`;
  }
}

const SHORTCUTS: GoalOpId[] = [
  "make_leaner",
  "optimize_growth",
  "optimize_support",
  "reduce_costs",
  "add_qc",
  "increase_speed",
  "more_cautious",
  "prepare_expansion",
  "design_around_humans",
];

/**
 * Persistent Maya panel — goal shortcuts (PR-22D) + free-text Ask Maya.
 */
export function NlEditBar({
  asking,
  proposal,
  message,
  onAsk,
  onGoalOp,
  onApply,
  onDiscard,
}: {
  asking: boolean;
  proposal: { proposal: NlEditProposal; ops: NlEditDiffOp[]; impact?: GoalOpImpactSummary | null } | null;
  message: string | null;
  onAsk: (instruction: string) => void;
  onGoalOp: (op: GoalOpId) => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const [instruction, setInstruction] = useState("");

  return (
    <Card className="studio-fade-up space-y-3 p-4">
      <div>
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <Sparkles className="h-3.5 w-3.5 text-accent" /> Maya
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
          Goal-based edits propose a reviewable diff with capacity impact. Brain model choice stays automatic.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        {SHORTCUTS.map((op) => (
          <button
            key={op}
            type="button"
            disabled={asking}
            onClick={() => onGoalOp(op)}
            className="rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-left text-[11px] text-ink-2 hover:border-accent/40 hover:text-ink disabled:opacity-50"
          >
            {GOAL_OP_LABELS[op]}
          </button>
        ))}
      </div>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!instruction.trim() || asking) return;
          onAsk(instruction.trim());
        }}
      >
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          placeholder='e.g. "add a second backend engineer for mobile"'
          className="input-field text-[13px]"
          aria-label="Ask Maya to adjust the team"
        />
        <Button type="submit" size="sm" variant="outline" disabled={asking || !instruction.trim()} className="w-full">
          {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ask Maya"}
        </Button>
      </form>

      {asking ? <p className="text-[11px] text-ink-3">Maya is thinking…</p> : null}
      {message ? <p className="text-[12px] text-ink-3">{message}</p> : null}

      {proposal ? (
        <div className="space-y-2 rounded-lg border border-accent/30 bg-accent-soft/20 p-3">
          <p className="text-[12px] font-medium text-accent-d">{proposal.proposal.summary}</p>
          <ul className="space-y-1">
            {proposal.ops.map((op, i) => (
              <li key={i} className="flex items-center gap-1.5 text-[12px] text-ink-2">
                {OP_ICON[op.kind]}
                {opLabel(op)}
              </li>
            ))}
          </ul>
          {proposal.impact ? (
            <div className="rounded-md border border-border/60 bg-surface/80 px-2 py-1.5 text-[11px] text-ink-2">
              <p className="font-medium text-ink">Expected impact</p>
              <ul className="mt-1 space-y-0.5">
                {proposal.impact.bullets.map((b) => (
                  <li key={b}>· {b}</li>
                ))}
              </ul>
              <p className="mt-1 text-ink-3">
                Capacity {proposal.impact.beforeLowWh}–{proposal.impact.beforeHighWh} →{" "}
                {proposal.impact.afterLowWh}–{proposal.impact.afterHighWh} WH
              </p>
            </div>
          ) : null}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              onClick={() => {
                onApply();
                setInstruction("");
              }}
            >
              <Check className="h-3.5 w-3.5" /> Apply
            </Button>
            <Button size="sm" variant="ghost" onClick={onDiscard}>
              <X className="h-3.5 w-3.5" /> Discard
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
