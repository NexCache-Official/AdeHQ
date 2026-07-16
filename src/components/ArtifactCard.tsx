"use client";

import { useState } from "react";
import { cn, formatTime } from "@/lib/utils";
import {
  Check,
  Clipboard,
  Copy,
  FileSpreadsheet,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Save,
  ScrollText,
} from "lucide-react";

type ArtifactType =
  | "prd"
  | "report"
  | "brief"
  | "proposal"
  | "decision"
  | "note"
  | "image"
  | "video";
type ArtifactStatus = "draft" | "saved";

const TYPE_META: Record<ArtifactType, { label: string; icon: typeof FileText; tone: string }> = {
  prd: { label: "PRD", icon: Clipboard, tone: "bg-accent-soft text-accent-d" },
  report: { label: "Report", icon: ScrollText, tone: "bg-sky-50 text-sky-700" },
  brief: { label: "Brief", icon: FileText, tone: "bg-emerald-50 text-emerald-700" },
  proposal: { label: "Proposal", icon: FolderOpen, tone: "bg-amber-50 text-amber-700" },
  decision: { label: "Decision", icon: Check, tone: "bg-cyan-50 text-cyan-700" },
  note: { label: "Note", icon: FileText, tone: "bg-muted text-ink-2" },
  image: { label: "Image", icon: ImageIcon, tone: "bg-violet-50 text-violet-700" },
  video: { label: "Video", icon: Film, tone: "bg-rose-50 text-rose-700" },
};

export function ArtifactCard({
  title,
  type = "note",
  createdBy,
  timestamp,
  sourceCount = 0,
  status = "draft",
  onOpen,
  onSave,
  onCopy,
  className,
}: {
  title: string;
  type?: ArtifactType;
  createdBy?: string;
  timestamp?: string;
  sourceCount?: number;
  status?: ArtifactStatus;
  onOpen?: () => void;
  onSave?: () => void;
  onCopy?: () => void;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const meta = TYPE_META[type] ?? TYPE_META.note;
  const Icon = meta.icon;

  const copy = async () => {
    if (onCopy) {
      onCopy();
    } else {
      await navigator.clipboard.writeText(title);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className={cn(
        "mt-2.5 w-full max-w-xl rounded-xl border border-border bg-surface p-3 shadow-[0_8px_24px_-22px_rgba(40,30,15,0.28)]",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", meta.tone)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-[6px] border border-border-2 bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-2">
              {meta.label}
            </span>
            <span
              className={cn(
                "rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold",
                status === "saved" ? "bg-green-soft text-green" : "bg-amber-soft text-amber",
              )}
            >
              {status === "saved" ? "Saved" : "Draft"}
            </span>
            {sourceCount > 0 && (
              <span className="text-[11px] text-ink-3">
                {sourceCount} source{sourceCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <h3 className="mt-1 truncate text-sm font-semibold text-ink">{title}</h3>
          {(createdBy || timestamp) && (
            <p className="mt-0.5 text-[11px] text-ink-3">
              {createdBy ? `Created by ${createdBy}` : "Created"}
              {timestamp ? ` · ${formatTime(timestamp)}` : ""}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-ink-2 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Open
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!onSave || status === "saved"}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-ink-2 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-ink-2 transition-colors hover:bg-muted"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function FileArtifactCard({
  fileName,
  extension,
  size,
  status = "attached",
  onRemove,
  className,
}: {
  fileName: string;
  extension?: string;
  size?: string;
  status?: "attached" | "uploading" | "processing" | "ready" | "failed";
  onRemove?: () => void;
  className?: string;
}) {
  const isSheet = ["csv", "xls", "xlsx"].includes((extension ?? "").toLowerCase());
  const Icon = isSheet ? FileSpreadsheet : FileText;

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-[0_8px_20px_-22px_rgba(40,30,15,0.35)]",
        className,
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-accent-soft text-accent-d">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-ink">{fileName}</span>
        <span className="block text-[10px] text-ink-3">
          {[extension?.toUpperCase(), size, status].filter(Boolean).join(" · ")}
        </span>
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md px-1.5 py-1 text-[11px] font-medium text-ink-3 transition-colors hover:bg-muted hover:text-ink"
        >
          Remove
        </button>
      )}
    </div>
  );
}
