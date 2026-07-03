"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/demo-store";
import { effectiveEmployeeStatus } from "@/lib/maya-employee";
import type { MentionRef } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { STATUS_META } from "@/lib/icons";
import { Bot, Mail, User } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

function MentionProfileCard({
  mention,
  onClose,
}: {
  mention: MentionRef;
  onClose: () => void;
}) {
  const { state } = useStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const employee =
    mention.type === "ai_employee"
      ? state.employees.find((e) => e.id === mention.id)
      : undefined;
  const human =
    mention.type === "human"
      ? state.workspaceMembers.find((m) => m.userId === mention.id)
      : undefined;

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const status = employee ? effectiveEmployeeStatus(employee) : null;

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full left-0 z-40 mb-1 w-[min(17rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-panel"
      role="dialog"
      aria-label={`${mention.label} profile`}
    >
      <div className="flex items-start gap-3 border-b border-border-2 p-3">
        {employee ? (
          <EmployeeAvatar employee={employee} size="md" showStatus />
        ) : (
          <HumanAvatar name={mention.label} size="md" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-ink">{mention.label}</p>
            <span
              className={cn(
                "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                mention.type === "ai_employee"
                  ? "bg-accent-soft text-accent"
                  : "bg-muted text-ink-3",
              )}
            >
              {mention.type === "ai_employee" ? "AI" : "Human"}
            </span>
          </div>
          {employee ? (
            <p className="mt-0.5 truncate text-xs text-ink-2">{employee.role}</p>
          ) : human?.role ? (
            <p className="mt-0.5 truncate text-xs text-ink-2">{ROLE_LABELS[human.role] ?? human.role}</p>
          ) : (
            <p className="mt-0.5 text-xs text-ink-3">Workspace member</p>
          )}
        </div>
      </div>

      <div className="space-y-2 p-3 text-xs text-ink-2">
        {employee && status && (
          <div className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[status].dot)} />
            <span>{STATUS_META[status].label}</span>
          </div>
        )}
        {employee?.instructions && (
          <p className="line-clamp-3 leading-relaxed text-ink-3">{employee.instructions}</p>
        )}
        {human?.email && (
          <div className="flex items-center gap-1.5 text-ink-3">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{human.email}</span>
          </div>
        )}
        {!employee && !human?.email && mention.type === "human" && (
          <div className="flex items-center gap-1.5 text-ink-3">
            <User className="h-3 w-3 shrink-0" />
            <span>Teammate in this room</span>
          </div>
        )}
        {employee?.systemEmployeeKey === "maya" && (
          <div className="flex items-center gap-1.5 text-ink-3">
            <Bot className="h-3 w-3 shrink-0" />
            <span>Hiring & workforce assistant</span>
          </div>
        )}
      </div>

      {employee && (
        <div className="border-t border-border-2 px-3 py-2">
          <Link
            href={`/workforce/${employee.id}`}
            className="text-xs font-medium text-accent hover:text-accent-d"
            onClick={onClose}
          >
            View full profile →
          </Link>
        </div>
      )}
    </div>
  );
}

export function MentionChip({ mention }: { mention: MentionRef }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded px-0.5 font-medium text-accent-d underline decoration-accent/30 underline-offset-2 transition-colors hover:bg-accent-soft/60 hover:text-accent"
      >
        @{mention.label}
      </button>
      {open && <MentionProfileCard mention={mention} onClose={() => setOpen(false)} />}
    </span>
  );
}
