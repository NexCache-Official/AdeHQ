"use client";

import type { SavedArtifact } from "@/lib/types";
import { FileText, Users, Wand2, BookOpen, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";

const KIND_META: Record<string, { label: string; icon: typeof FileText }> = {
  workforce_review: { label: "Workforce Review", icon: Users },
  improvement_plan: { label: "Improvement Plan", icon: Wand2 },
  adehq_guide: { label: "AdeHQ Guide", icon: BookOpen },
  room_setup: { label: "Room Setup Plan", icon: FolderPlus },
};

export function MayaArtifactCard({
  artifact,
  className,
  onOpen,
}: {
  artifact: Pick<SavedArtifact, "id" | "title" | "artifactType" | "metadata">;
  className?: string;
  onOpen?: () => void;
}) {
  const kind = String(
    (artifact as { metadata?: Record<string, unknown> }).metadata?.mayaArtifactKind ??
      (artifact as { contentJson?: Record<string, unknown> }).contentJson?.mayaArtifactKind ??
      "report",
  );
  const meta = KIND_META[kind] ?? { label: "Artifact", icon: FileText };
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        "mt-2 w-full max-w-lg rounded-xl border border-border bg-surface px-3.5 py-3 shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{meta.label}</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{artifact.title}</p>
          <p className="mt-1 text-[10px] text-ink-3">Source: Maya · Saved artifact</p>
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              className="mt-2 rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-muted"
            >
              Open
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MayaEmployeePickerCard({
  employees,
  onSelect,
  disabled,
  className,
}: {
  employees: Array<{ id: string; name: string; role: string }>;
  onSelect: (employeeId: string, name: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("mt-2 w-full max-w-lg rounded-xl border border-border bg-surface px-3.5 py-3", className)}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Choose an employee</p>
      <div className="mt-2 space-y-1.5">
        {employees.slice(0, 6).map((e) => (
          <button
            key={e.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(e.id, e.name)}
            className="flex w-full items-center justify-between rounded-lg border border-border bg-canvas px-3 py-2 text-left text-sm hover:bg-muted"
          >
            <span className="font-medium text-ink">{e.name}</span>
            <span className="text-xs text-ink-3">{e.role}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
