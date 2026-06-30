"use client";

import type { ConversationPlan } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";

function roleLabel(participant: ConversationPlan["participants"][number]): string {
  const name = participant.employeeName;
  switch (participant.role) {
    case "lead":
      return `${name} — Leading`;
    case "collaborator":
      return participant.waitingOnEmployeeName
        ? `${name} — Waiting to build on ${participant.waitingOnEmployeeName}'s findings`
        : `${name} — Collaborating`;
    default:
      return name;
  }
}

export function CollaborationPlanBanner({
  plan,
  leadFinishedName,
  activeEmployeeName,
  className,
}: {
  plan: ConversationPlan;
  leadFinishedName?: string;
  activeEmployeeName?: string;
  className?: string;
}) {
  if (plan.mode !== "lead_collaborator" && plan.mode !== "ambient_collaboration" && plan.mode !== "panel_response") return null;

  return (
    <div
      className={cn(
        "mx-auto mb-2 max-w-3xl rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5 text-xs",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-slate-700">
        <Users className="h-3.5 w-3.5 text-accent-600" />
        {plan.mode === "panel_response" ? "Panel response" : "Collaboration started"}
      </div>
      {leadFinishedName && activeEmployeeName ? (
        <p className="text-slate-600">
          <span className="font-medium text-slate-700">{leadFinishedName}</span> finished initial
          analysis.{" "}
          <span className="font-medium text-slate-700">{activeEmployeeName}</span> is preparing
          their contribution…
        </p>
      ) : (
        <ul className="space-y-1 text-slate-600">
          {plan.participants.map((p) => (
            <li key={p.employeeId}>
              <span className="font-medium text-slate-700">{roleLabel(p)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
