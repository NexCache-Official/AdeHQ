"use client";

import Link from "next/link";
import type { MessageArtifact } from "@/lib/types";
import { Briefcase, Building2, User } from "lucide-react";

export function CrmInlineCard({ artifact }: { artifact: MessageArtifact }) {
  const Icon =
    artifact.type === "crm_deal"
      ? Briefcase
      : artifact.type === "crm_company"
        ? Building2
        : User;
  const kind =
    artifact.type === "crm_deal"
      ? "Deal"
      : artifact.type === "crm_company"
        ? "Company"
        : "Contact";
  const href = artifact.meta?.href ?? "/crm";

  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-left shadow-sm transition hover:border-accent/30 hover:bg-accent-soft/20"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-2">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
          CRM {kind}
        </div>
        <div className="truncate text-sm font-medium text-ink">{artifact.label}</div>
        {artifact.meta?.subtitle && (
          <div className="truncate text-xs text-ink-3">{artifact.meta.subtitle}</div>
        )}
      </div>
      <span className="shrink-0 text-xs font-medium text-accent">Open</span>
    </Link>
  );
}
