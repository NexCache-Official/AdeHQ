"use client";

import type { OrchestrationPlan } from "@/lib/orchestration/types";
import type { ConversationPlan } from "@/lib/types";
import { Users } from "lucide-react";

function labelForPlan(
  orchestration?: OrchestrationPlan | null,
  collaboration?: ConversationPlan | null,
): string | null {
  if (orchestration?.intent === "panel_response" && orchestration.selectedEmployeeIds.length >= 2) {
    const names = orchestration.responseOrder.map((r) => r.employeeId).length;
    return `Panel response · ${orchestration.selectedEmployeeIds.length} employees`;
  }
  if (orchestration?.intent === "lead_collaborator" && orchestration.leadEmployeeId) {
    const collabCount = orchestration.collaboratorEmployeeIds?.length ?? 0;
    return collabCount > 0
      ? `Collaboration · lead + ${collabCount} collaborator${collabCount === 1 ? "" : "s"}`
      : "Collaboration";
  }
  if (orchestration?.intent === "handoff") return "Handoff in progress";
  if (orchestration?.intent === "ambient_smart_assist" && orchestration.shouldRespond) {
    return "Smart Assist selected relevant employees";
  }
  if (collaboration?.mode === "panel_response") return "Panel response";
  if (collaboration?.mode === "lead_collaborator") return "Lead + collaborator";
  return null;
}

export function OrchestrationIndicator({
  orchestrationPlan,
  collaborationPlan,
  debug,
}: {
  orchestrationPlan?: OrchestrationPlan | null;
  collaborationPlan?: ConversationPlan | null;
  debug?: Record<string, unknown> | null;
}) {
  const label = labelForPlan(orchestrationPlan, collaborationPlan);
  const showDebug = process.env.NEXT_PUBLIC_ORCHESTRATION_DEBUG === "true" && debug;

  if (!label && !showDebug) return null;

  return (
    <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2 text-xs text-slate-600">
      {label && (
        <div className="flex items-center gap-1.5 font-medium text-slate-700">
          <Users className="h-3.5 w-3.5 shrink-0" />
          {label}
        </div>
      )}
      {showDebug && (
        <pre className="mt-1 overflow-x-auto text-[10px] text-slate-500">
          {JSON.stringify(debug, null, 2)}
        </pre>
      )}
    </div>
  );
}
