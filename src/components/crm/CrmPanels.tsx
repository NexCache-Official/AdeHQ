"use client";

import Link from "next/link";
import { cn, timeAgo } from "@/lib/utils";
import { formatDealAmount } from "@/lib/crm/client";
import type { CrmContact, CrmDeal, CrmCompany } from "@/lib/crm/types";
import { Building2, Mail, Phone, User } from "lucide-react";

export function CrmSummaryStrip({
  contactCount,
  companyCount,
  openDealCount,
  openPipelineValue,
}: {
  contactCount: number;
  companyCount: number;
  openDealCount: number;
  openPipelineValue: number;
}) {
  const items = [
    { label: "Contacts", value: contactCount },
    { label: "Companies", value: companyCount },
    { label: "Open deals", value: openDealCount },
    {
      label: "Pipeline value",
      value: formatDealAmount(openPipelineValue),
      mono: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm"
        >
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
            {item.label}
          </div>
          <div
            className={cn(
              "mt-1 text-xl font-semibold tracking-tight text-ink",
              item.mono && "font-mono text-lg",
            )}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CrmContactRow({
  contact,
  selected,
  onClick,
}: {
  contact: CrmContact;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition",
        selected
          ? "border-accent/40 bg-accent-soft/40"
          : "border-border bg-surface hover:border-ink/20 hover:bg-muted/40",
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-ink-2">
        <User className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink">{contact.fullName}</div>
        <div className="truncate text-xs text-ink-3">
          {[contact.title, contact.companyName].filter(Boolean).join(" · ") || "No company"}
        </div>
      </div>
      <span className="shrink-0 text-[10px] text-ink-3">{timeAgo(contact.createdAt)}</span>
    </button>
  );
}

export function CrmCompanyRow({
  company,
  selected,
  onClick,
}: {
  company: CrmCompany;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition",
        selected
          ? "border-accent/40 bg-accent-soft/40"
          : "border-border bg-surface hover:border-ink/20 hover:bg-muted/40",
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-ink-2">
        <Building2 className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink">{company.name}</div>
        <div className="truncate text-xs text-ink-3">
          {[company.industry, company.domain].filter(Boolean).join(" · ") || "Company"}
        </div>
      </div>
    </button>
  );
}

export function CrmDealCard({
  deal,
  selected,
  onClick,
  compact = false,
}: {
  deal: CrmDeal;
  selected?: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const statusTone =
    deal.status === "won"
      ? "bg-emerald-50 text-emerald-700"
      : deal.status === "lost"
        ? "bg-slate-100 text-slate-500"
        : "bg-accent-soft text-accent";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border text-left transition",
        compact ? "px-3 py-2.5" : "px-3.5 py-3",
        selected
          ? "border-accent/40 bg-accent-soft/30 ring-1 ring-accent/20"
          : "border-border bg-surface hover:border-ink/20 hover:shadow-sm",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink">{deal.name}</div>
          {!compact && (
            <div className="mt-0.5 text-xs text-ink-3">{deal.stageName}</div>
          )}
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", statusTone)}>
          {deal.status}
        </span>
      </div>
      <div className="mt-2 font-mono text-sm font-semibold text-ink">
        {formatDealAmount(deal.amount, deal.currency)}
      </div>
    </button>
  );
}

export function CrmDetailDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close details"
        className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-ink">{title}</h2>
              {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-ink-2 hover:bg-muted"
            >
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-border px-5 py-4">{footer}</div>}
      </aside>
    </>
  );
}

export function CrmContactDetail({ contact }: { contact: CrmContact }) {
  return (
    <div className="space-y-4">
      <DetailField label="Email" value={contact.email} icon={<Mail className="h-3.5 w-3.5" />} />
      <DetailField label="Phone" value={contact.phone} icon={<Phone className="h-3.5 w-3.5" />} />
      <DetailField label="Title" value={contact.title} />
      <DetailField label="Company" value={contact.companyName} />
      <DetailField label="Source" value={contact.source} />
      {contact.notes && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Notes
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{contact.notes}</p>
        </div>
      )}
      <p className="text-xs text-ink-3">Added {timeAgo(contact.createdAt)}</p>
    </div>
  );
}

export function CrmDealDetail({
  deal,
  contact,
  company,
}: {
  deal: CrmDeal;
  contact?: CrmContact | null;
  company?: CrmCompany | null;
}) {
  return (
    <div className="space-y-4">
      <DetailField label="Amount" value={formatDealAmount(deal.amount, deal.currency)} />
      <DetailField label="Stage" value={deal.stageName} />
      <DetailField label="Status" value={deal.status} />
      <DetailField label="Expected close" value={deal.expectedCloseDate} />
      {contact && (
        <DetailField
          label="Contact"
          value={
            <Link href={`/crm?contact=${contact.id}`} className="text-accent hover:underline">
              {contact.fullName}
            </Link>
          }
        />
      )}
      {company && <DetailField label="Company" value={company.name} />}
      {deal.notes && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Notes
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{deal.notes}</p>
        </div>
      )}
      <p className="text-xs text-ink-3">Updated {timeAgo(deal.updatedAt)}</p>
    </div>
  );
}

function DetailField({
  label,
  value,
  icon,
}: {
  label: string;
  value?: React.ReactNode | string | null;
  icon?: React.ReactNode;
}) {
  if (value == null || value === "") return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div className="flex items-center gap-2 text-sm text-ink">
        {icon}
        <span>{value}</span>
      </div>
    </div>
  );
}
