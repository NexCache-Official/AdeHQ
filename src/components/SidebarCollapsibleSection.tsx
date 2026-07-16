"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChevronRight, type LucideIcon } from "lucide-react";

export function SidebarCollapsibleSection({
  storageKey,
  label,
  icon: Icon,
  href,
  count,
  showUnreadDot,
  isSectionActive,
  forceOpen,
  headerAction,
  children,
}: {
  storageKey: string;
  label: string;
  icon: LucideIcon;
  href: string;
  count?: number;
  showUnreadDot?: boolean;
  isSectionActive?: boolean;
  forceOpen?: boolean;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) setOpen(saved === "1");
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--rail-ink-3)] transition-colors hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]"
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-90")}
            strokeWidth={2.2}
          />
        </button>
        <Link
          href={href}
          className={cn(
            "nav-link min-w-0 flex-1 !gap-2.5 !px-2 !py-1.5",
            isSectionActive && "nav-link-active",
          )}
        >
          <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count !== undefined && count > 0 && (
            <span className="shrink-0 rounded-md bg-[var(--rail-badge-bg)] px-1.5 py-px font-mono text-[10.5px] text-[var(--rail-badge-ink)]">
              {count}
            </span>
          )}
          {showUnreadDot && (
            <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent" />
          )}
        </Link>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="mb-1 ml-3 mt-1 max-h-[min(280px,38vh)] space-y-0.5 overflow-y-auto border-l border-[var(--rail-border)] pl-2.5 pr-0.5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SidebarNestedLink({
  href,
  active,
  icon,
  label,
  badge,
}: {
  href: string;
  active?: boolean;
  icon: ReactNode;
  label: string;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium leading-none transition-colors",
        active
          ? "bg-[var(--rail-active-bg)] text-[var(--rail-active-ink)]"
          : "text-[var(--rail-ink-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]",
      )}
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center opacity-70 [&_svg]:h-3.5 [&_svg]:w-3.5">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge}
    </Link>
  );
}

export function SidebarNestedButton({
  onClick,
  active,
  icon,
  label,
  badge,
}: {
  onClick: () => void;
  active?: boolean;
  icon: ReactNode;
  label: string;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium leading-none transition-colors",
        active
          ? "bg-[var(--rail-active-bg)] text-[var(--rail-active-ink)]"
          : "text-[var(--rail-ink-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]",
      )}
    >
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate self-center">{label}</span>
      {badge}
    </button>
  );
}
