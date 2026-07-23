"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChevronDown, type LucideIcon } from "lucide-react";

export function SidebarCollapsibleSection({
  storageKey,
  label,
  icon: Icon,
  href,
  count,
  countVariant = "muted",
  showUnreadDot,
  isSectionActive,
  forceOpen,
  headerAction,
  children,
}: {
  storageKey: string;
  label: string;
  icon?: LucideIcon;
  href: string;
  count?: number;
  /** `pill` matches DM unread-style dark badge in the design rail. */
  countVariant?: "muted" | "pill";
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
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-lg px-2 py-[5px] text-[13.5px] font-medium text-[var(--rail-ink-2)]",
          isSectionActive && "text-[var(--rail-ink)]",
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          className="flex shrink-0 items-center justify-center text-[var(--rail-ink-3)] transition-colors hover:text-[var(--rail-ink)]"
        >
          <ChevronDown
            className={cn("h-[11px] w-[11px] transition-transform duration-200", !open && "-rotate-90")}
            strokeWidth={2.6}
          />
        </button>
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-2 truncate">
          {Icon ? <Icon className="h-4 w-4 shrink-0 text-[var(--rail-icon)]" strokeWidth={1.9} /> : null}
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </Link>
        {count !== undefined && count > 0 && (
          countVariant === "pill" ? (
            <span className="shrink-0 rounded-full bg-[var(--rail-ink)] px-1.5 py-px font-mono text-[10px] font-medium text-white">
              {count}
            </span>
          ) : (
            <span className="mr-0.5 shrink-0 font-mono text-[10.5px] text-[var(--rail-ink-3)]">
              {count}
            </span>
          )
        )}
        {showUnreadDot && countVariant !== "pill" && (
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--rail-ink)]" />
        )}
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-w-0 overflow-hidden">
          <div className="mb-0.5 max-h-[min(280px,38vh)] min-w-0 space-y-0.5 overflow-y-auto overflow-x-hidden pr-0.5">
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
  icon?: ReactNode;
  label: string;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-1.5 rounded-lg py-1.5 pl-[27px] pr-2 text-[13.5px] transition-colors",
        active
          ? "bg-[var(--rail-active-bg)] font-medium text-[var(--rail-active-ink)]"
          : "text-[var(--rail-ink-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]",
      )}
    >
      {icon ? (
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[var(--rail-ink-3)] [&_svg]:h-3.5 [&_svg]:w-3.5">
          {icon}
        </span>
      ) : (
        <span className="mr-1.5 shrink-0 text-[var(--rail-ink-3)]">#</span>
      )}
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
        "flex w-full min-w-0 max-w-full items-center gap-2 rounded-lg px-2 py-[5px] text-left text-[13.5px] transition-colors",
        active
          ? "bg-[var(--rail-active-bg)] font-medium text-[var(--rail-active-ink)]"
          : "text-[var(--rail-ink-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate self-center">{label}</span>
      {badge ? <span className="min-w-0 shrink truncate">{badge}</span> : null}
    </button>
  );
}
