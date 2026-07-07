"use client";

/**
 * Workspace UI kit — the shared design language for the business apps
 * (Tasks, CRM, Calendar, Investors). Built on the real AdeHQ tokens
 * (surface / ink / accent / muted / border), tuned to feel like a premium
 * SaaS suite (Monday / Asana / ClickUp class) with calm gradients and
 * crisp micro-interactions.
 */

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Search, TrendingDown, TrendingUp } from "lucide-react";

// ---------------------------------------------------------------------------
// Accent system — named tones map to token-driven gradient + text + soft bg.
// ---------------------------------------------------------------------------

export type Tone = "accent" | "violet" | "emerald" | "amber" | "rose" | "sky" | "slate" | "indigo";

type ToneStyle = {
  text: string;
  soft: string;
  ring: string;
  dot: string;
  grad: string;
  bar: string;
};

export const TONES: Record<Tone, ToneStyle> = {
  accent: {
    text: "text-accent-700",
    soft: "bg-accent-500/10",
    ring: "ring-accent-500/25",
    dot: "bg-accent-500",
    grad: "from-accent-500/18 via-accent-400/8 to-transparent",
    bar: "bg-accent-500",
  },
  violet: {
    text: "text-violet-700",
    soft: "bg-violet-500/10",
    ring: "ring-violet-500/25",
    dot: "bg-violet-500",
    grad: "from-violet-500/18 via-violet-400/8 to-transparent",
    bar: "bg-violet-500",
  },
  emerald: {
    text: "text-emerald-700",
    soft: "bg-emerald-500/10",
    ring: "ring-emerald-500/25",
    dot: "bg-emerald-500",
    grad: "from-emerald-500/18 via-emerald-400/8 to-transparent",
    bar: "bg-emerald-500",
  },
  amber: {
    text: "text-amber-700",
    soft: "bg-amber-500/10",
    ring: "ring-amber-500/25",
    dot: "bg-amber-500",
    grad: "from-amber-500/18 via-amber-400/8 to-transparent",
    bar: "bg-amber-500",
  },
  rose: {
    text: "text-rose-700",
    soft: "bg-rose-500/10",
    ring: "ring-rose-500/25",
    dot: "bg-rose-500",
    grad: "from-rose-500/18 via-rose-400/8 to-transparent",
    bar: "bg-rose-500",
  },
  sky: {
    text: "text-sky-700",
    soft: "bg-sky-500/10",
    ring: "ring-sky-500/25",
    dot: "bg-sky-500",
    grad: "from-sky-500/18 via-sky-400/8 to-transparent",
    bar: "bg-sky-500",
  },
  indigo: {
    text: "text-indigo-700",
    soft: "bg-indigo-500/10",
    ring: "ring-indigo-500/25",
    dot: "bg-indigo-500",
    grad: "from-indigo-500/18 via-indigo-400/8 to-transparent",
    bar: "bg-indigo-500",
  },
  slate: {
    text: "text-slate-600",
    soft: "bg-slate-500/10",
    ring: "ring-slate-500/20",
    dot: "bg-slate-400",
    grad: "from-slate-500/12 via-slate-400/6 to-transparent",
    bar: "bg-slate-400",
  },
};

export function toneOf(tone: Tone): ToneStyle {
  return TONES[tone];
}

// ---------------------------------------------------------------------------
// Canvas — a soft gradient + dotted texture backdrop that replaces flat grey.
// ---------------------------------------------------------------------------

export function WorkspaceCanvas({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-7 h-64 bg-gradient-to-b from-accent-500/[0.06] via-accent-500/[0.02] to-transparent"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-dots opacity-40" />
      <div className="relative">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini sparkline — pure SVG trend line for stat cards.
// ---------------------------------------------------------------------------

export function MiniSparkline({
  points,
  tone = "accent",
  className,
}: {
  points: number[];
  tone?: Tone;
  className?: string;
}) {
  if (points.length < 2) return null;
  const w = 96;
  const h = 30;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => [i * step, h - ((p - min) / span) * (h - 4) - 2] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const t = TONES[tone];
  const stroke = t.bar.replace("bg-", "");
  const id = `spark-${tone}-${points.join("-").slice(0, 12)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-24 overflow-visible", className)} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className={cn("[stop-color:currentColor]", t.text)} stopOpacity="0.25" />
          <stop offset="100%" className={cn("[stop-color:currentColor]", t.text)} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} className={t.text} fill={`url(#${id})`} stroke="none" />
      <path
        d={line}
        fill="none"
        className={t.text}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="2.2" className={cn("fill-current", t.text)} />
      {/* stroke color hint (Tailwind purge) */}
      <span className="hidden">{stroke}</span>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stat card — headline metric with icon, trend and optional sparkline.
// ---------------------------------------------------------------------------

export type StatDef = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: Tone;
  hint?: string;
  trend?: { value: number; label?: string };
  spark?: number[];
};

export function StatCard({ label, value, icon: Icon, tone = "accent", hint, trend, spark }: StatDef) {
  const t = TONES[tone];
  const up = (trend?.value ?? 0) >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-card transition-shadow hover:shadow-lift"
    >
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70", t.grad)} />
      <div className="relative flex items-start justify-between gap-2">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-inset", t.soft, t.ring, t.text)}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
        {spark && <MiniSparkline points={spark} tone={tone} />}
      </div>
      <div className="relative mt-3">
        <div className="text-[26px] font-bold leading-none tracking-tight text-ink">{value}</div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-xs font-medium text-ink-2">{label}</span>
          {trend && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] font-semibold",
                up ? "bg-emerald-500/12 text-emerald-700" : "bg-rose-500/12 text-rose-600",
              )}
            >
              {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(trend.value)}%
            </span>
          )}
        </div>
        {hint && <div className="mt-0.5 text-[11px] text-ink-3">{hint}</div>}
      </div>
    </motion.div>
  );
}

export function StatGrid({ stats, className }: { stats: StatDef[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {stats.map((s) => (
        <StatCard key={s.label} {...s} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control — animated view/tab switcher.
// ---------------------------------------------------------------------------

export type SegmentOption<T extends string> = { id: T; label: string; icon?: LucideIcon; count?: number };

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl border border-border bg-muted/60 p-0.5">
      {options.map((opt) => {
        const active = opt.id === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              "relative flex items-center gap-1.5 rounded-lg font-medium transition-colors",
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
              active ? "text-ink" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${options.map((o) => o.id).join("")}`}
                className="absolute inset-0 rounded-lg bg-surface shadow-sm ring-1 ring-border"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {opt.label}
              {opt.count != null && (
                <span className={cn("rounded-md px-1 text-[10px] font-semibold", active ? "bg-accent-500/12 text-accent-700" : "bg-ink/5 text-ink-3")}>
                  {opt.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search input — compact, icon-led.
// ---------------------------------------------------------------------------

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  onSubmit,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  className?: string;
}) {
  return (
    <form
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-all placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent-soft"
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Status pill + priority dot.
// ---------------------------------------------------------------------------

export function StatusPill({
  tone,
  label,
  dot = true,
  className,
}: {
  tone: Tone;
  label: string;
  dot?: boolean;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        t.soft,
        t.text,
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress meter — thin, gradient-filled.
// ---------------------------------------------------------------------------

export function ProgressMeter({
  value,
  tone = "accent",
  className,
  height = "h-1.5",
}: {
  value: number;
  tone?: Tone;
  className?: string;
  height?: string;
}) {
  const t = TONES[tone];
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-ink/8", height, className)}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className={cn("h-full rounded-full", t.bar)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fit / score ring — small circular gauge (0-100).
// ---------------------------------------------------------------------------

export function ScoreRing({ score, tone = "accent", size = 34 }: { score: number; tone?: Tone; size?: number }) {
  const t = TONES[tone];
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} className="fill-none stroke-ink/10" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className={cn("fill-none", t.text)}
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
        />
      </svg>
      <span className="absolute text-[10px] font-bold text-ink">{Math.round(pct)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar — filter/search/view row wrapper.
// ---------------------------------------------------------------------------

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-col gap-2.5 rounded-2xl border border-border bg-surface/70 p-2 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kanban column shell — gradient header, count, optional footer total.
// ---------------------------------------------------------------------------

export function KanbanColumn({
  title,
  tone = "slate",
  count,
  footer,
  children,
  onDragOver,
  onDrop,
  active,
  width = "w-[288px]",
}: {
  title: string;
  tone?: Tone;
  count: number;
  footer?: React.ReactNode;
  children: React.ReactNode;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  active?: boolean;
  width?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "flex shrink-0 flex-col rounded-2xl border bg-muted/40 transition-colors",
        width,
        active ? cn("border-dashed ring-2", t.ring, t.soft) : "border-border",
      )}
    >
      <div className={cn("flex items-center justify-between rounded-t-2xl bg-gradient-to-b px-3 py-2.5", t.grad)}>
        <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <span className={cn("h-2 w-2 rounded-full", t.dot)} />
          {title}
        </span>
        <span className="rounded-md bg-surface/70 px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">{count}</span>
      </div>
      <div className="flex-1 space-y-2 p-2">{children}</div>
      {footer && <div className="border-t border-border/60 px-3 py-2 text-[11px] text-ink-2">{footer}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty column placeholder.
// ---------------------------------------------------------------------------

export function ColumnEmpty({ label = "Drop items here" }: { label?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 py-7 text-center text-[11px] text-ink-3">
      {label}
    </div>
  );
}
