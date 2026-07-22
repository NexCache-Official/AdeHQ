"use client";

import { useState, type ReactNode } from "react";
import { Sparkles, Loader2, Check, X, Plus, Minus, Pencil, Target } from "lucide-react";
import { Button, Card } from "@/components/ui";
import type { NlEditDiffOp, NlEditProposal } from "@/lib/hiring/workforce-studio/nl-edit-apply";

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

/**
 * "Ask Maya" — natural-language edits to the roster with a reviewable diff.
 * Nothing is applied until the admin clicks Apply; Discard leaves the draft
 * untouched. Applying merges into the local draft via updatePayload, so it
 * participates in the normal undo/redo stack and Save/lock flow like any
 * other edit.
 */
export function NlEditBar({
  asking,
  proposal,
  message,
  onAsk,
  onApply,
  onDiscard,
}: {
  asking: boolean;
  proposal: { proposal: NlEditProposal; ops: NlEditDiffOp[] } | null;
  message: string | null;
  onAsk: (instruction: string) => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const [instruction, setInstruction] = useState("");

  return (
    <Card className="space-y-3 p-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!instruction.trim() || asking) return;
          onAsk(instruction.trim());
        }}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-accent" />
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder='Ask Maya to adjust the team — "add a second backend engineer for mobile"'
          className="min-w-0 flex-1 border-none bg-transparent text-[13px] outline-none placeholder:text-ink-3"
          aria-label="Ask Maya to adjust the team"
        />
        <Button type="submit" size="sm" variant="outline" disabled={asking || !instruction.trim()}>
          {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ask"}
        </Button>
      </form>

      {asking ? <p className="text-[11px] text-ink-3">Maya is thinking — this can take up to a minute.</p> : null}
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
