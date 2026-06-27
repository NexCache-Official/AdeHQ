"use client";

import { WorkLogEvent } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { cn, timeAgo } from "@/lib/utils";
import { toolIcon } from "@/lib/icons";
import {
  BrainCircuit,
  CheckCircle2,
  Clock,
  FileText,
  ListChecks,
  ShieldAlert,
  XCircle,
} from "lucide-react";

const STATUS_META = {
  success: { icon: CheckCircle2, color: "text-emerald-700", ring: "ring-emerald-400/20" },
  pending: { icon: Clock, color: "text-sky-700", ring: "ring-sky-400/20" },
  failed: { icon: XCircle, color: "text-rose-600", ring: "ring-rose-400/20" },
  needs_approval: { icon: ShieldAlert, color: "text-amber-700", ring: "ring-amber-400/20" },
};

const ENTITY_ICON = {
  task: ListChecks,
  memory: BrainCircuit,
  approval: ShieldAlert,
  message: FileText,
};

export function WorkLogTimeline({
  events,
  compact = false,
}: {
  events: WorkLogEvent[];
  compact?: boolean;
}) {
  const { state } = useStore();

  return (
    <div className="relative">
      <div className="absolute bottom-2 left-[19px] top-2 w-px bg-slate-100" />
      <div className="space-y-1">
        {events.map((event) => {
          const employee = state.employees.find((e) => e.id === event.employeeId);
          const status = STATUS_META[event.status];
          const StatusIcon = status.icon;
          const room = state.rooms.find((r) => r.id === event.roomId);
          const EntityIcon = event.relatedEntityType ? ENTITY_ICON[event.relatedEntityType] : null;
          const TI = event.toolUsed
            ? toolIcon(
                state.tools.find((t) => t.name === event.toolUsed)?.id ?? "",
              )
            : null;

          return (
            <div key={event.id} className="relative flex gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-slate-50">
              <div className="relative z-10 shrink-0">
                {employee ? (
                  <EmployeeAvatar employee={employee} size="sm" showStatus={false} />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100">
                    <FileText className="h-4 w-4 text-slate-400" />
                  </div>
                )}
                <span className={cn("absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2 ring-white", status.color)}>
                  <StatusIcon className="h-3 w-3" />
                </span>
              </div>

              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-sm font-medium text-slate-700">{employee?.name ?? "AdeHQ"}</span>
                  <span className="text-sm text-slate-500">{event.action.toLowerCase()}</span>
                </div>
                {!compact && <p className="mt-0.5 text-xs text-slate-500">{event.summary}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  {event.toolUsed && TI && (
                    <span className="flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5">
                      <TI className="h-3 w-3" /> {event.toolUsed}
                    </span>
                  )}
                  {EntityIcon && (
                    <span className="flex items-center gap-1 text-slate-500">
                      <EntityIcon className="h-3 w-3" /> {event.relatedEntityType}
                    </span>
                  )}
                  {!compact && room && <span>· {room.name}</span>}
                  <span className="ml-auto">{timeAgo(event.createdAt)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
