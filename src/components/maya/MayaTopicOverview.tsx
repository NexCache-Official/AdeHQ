"use client";

import { MAYA_EMPLOYEE_SUBTITLE, MAYA_EMPLOYEE_TITLE } from "@/lib/hiring/maya";
import { useOptionalMayaDmHiringContext } from "@/components/maya/MayaDmHiringContext";
import { isHiringTopic } from "@/lib/topics";
import type { AIEmployee, RoomTopic } from "@/lib/types";
import { Sparkles, Users, Wand2 } from "lucide-react";

export function MayaTopicOverview({
  topic,
  employees,
}: {
  topic: RoomTopic;
  employees: AIEmployee[];
}) {
  const hiring = useOptionalMayaDmHiringContext();
  const roster = employees.filter((e) => e.id !== "emp-maya");
  const hiringActive = isHiringTopic(topic);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Maya</p>
        <p className="text-sm font-medium text-ink">{MAYA_EMPLOYEE_TITLE}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">{MAYA_EMPLOYEE_SUBTITLE}</p>
      </div>
      <div className="space-y-1.5 text-xs text-ink-2">
        <p className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Hire and shape AI employee roles
        </p>
        <p className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-accent" />
          Review workforce ({roster.length} employee{roster.length === 1 ? "" : "s"})
        </p>
        <p className="flex items-center gap-1.5">
          <Wand2 className="h-3.5 w-3.5 text-accent" />
          Improve instructions, tools, and memory
        </p>
      </div>
      {hiringActive && hiring && (
        <div className="rounded-lg border border-border bg-surface px-2.5 py-2">
          <p className="text-[11px] font-semibold text-ink">Active hiring session</p>
          <p className="mt-0.5 text-xs text-ink-2">
            {hiring.session.customRoleTitle || hiring.session.roleKey?.replace(/_/g, " ") || "Role"} ·{" "}
            {hiring.displayReadiness.ready ? "Ready" : "In progress"}
          </p>
          {hiring.visibleCandidates.length > 0 && (
            <p className="mt-1 text-[11px] text-ink-3">
              {hiring.visibleCandidates.length} candidate
              {hiring.visibleCandidates.length === 1 ? "" : "s"} in shortlist
            </p>
          )}
        </div>
      )}
    </div>
  );
}
