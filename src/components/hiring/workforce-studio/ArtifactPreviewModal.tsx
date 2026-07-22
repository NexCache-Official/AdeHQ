"use client";

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { Modal, ModalHeader } from "@/components/ui";
import { MessageMarkdown } from "@/components/MessageMarkdown";
import { buildTeamCharterMarkdown, buildRoleScorecardMarkdown } from "@/lib/hiring/workforce-studio/artifact-templates";
import type { WorkforceBlueprintPayload } from "@/lib/hiring/workforce-studio/types";

/**
 * Pre-approval preview of the artifacts Maya will actually generate at
 * provisioning time (Team Charter + one Role Scorecard per seat). Uses the
 * exact same pure builders as plan-executor.ts, so what you see here is a
 * lightweight but faithful draft of the polished, persisted artifact —
 * matching AdeHQ's generated -> reviewed -> approved -> superseded lifecycle
 * (the real rows are created with status "saved" once the blueprint is
 * approved and provisioned; this is the "generated" preview stage before
 * that commit).
 */
export function ArtifactPreviewModal({
  open,
  onClose,
  blueprintName,
  payload,
}: {
  open: boolean;
  onClose: () => void;
  blueprintName: string;
  payload: WorkforceBlueprintPayload;
}) {
  const [activeSeatId, setActiveSeatId] = useState<string | null>(null);

  const teamCharter = useMemo(() => buildTeamCharterMarkdown(blueprintName, payload), [blueprintName, payload]);
  const activeSeat = payload.seats.find((s) => s.id === activeSeatId) ?? payload.seats[0] ?? null;
  const scorecard = useMemo(() => (activeSeat ? buildRoleScorecardMarkdown(activeSeat) : ""), [activeSeat]);

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHeader title="Artifact preview" onClose={onClose} />
      <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-[180px_1fr]">
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setActiveSeatId(null)}
            className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium ${
              !activeSeatId ? "bg-accent-soft text-accent-d" : "text-ink-2 hover:bg-muted"
            }`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" /> Team Charter
          </button>
          <div className="mt-2 px-2.5 text-[10px] uppercase tracking-wide text-ink-3">Role scorecards</div>
          {payload.seats.map((seat) => (
            <button
              key={seat.id}
              type="button"
              onClick={() => setActiveSeatId(seat.id)}
              className={`flex w-full items-center gap-1.5 truncate rounded-lg px-2.5 py-1.5 text-left text-[12px] ${
                activeSeatId === seat.id ? "bg-accent-soft text-accent-d font-medium" : "text-ink-2 hover:bg-muted"
              }`}
            >
              {seat.roleTitle}
            </button>
          ))}
        </div>
        <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-surface p-5">
          <MessageMarkdown content={activeSeatId ? scorecard : teamCharter} />
        </div>
      </div>
    </Modal>
  );
}
