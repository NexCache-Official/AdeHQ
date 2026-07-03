"use client";

import type { MemoryScope } from "@/lib/types";
import {
  defaultMemoryScope,
  memoryScopeOptions,
  memoryScopeSaveLabel,
  normalizeMemoryScope,
  type MemoryScopeContext,
} from "@/lib/memory/scope-rules";
import { cn } from "@/lib/utils";

type MemoryScopeSelectProps = {
  ctx: MemoryScopeContext;
  value?: MemoryScope;
  onChange: (scope: MemoryScope) => void;
  className?: string;
  compact?: boolean;
};

export function MemoryScopeSelect({
  ctx,
  value,
  onChange,
  className,
  compact = false,
}: MemoryScopeSelectProps) {
  const options = memoryScopeOptions(ctx);
  const selected = normalizeMemoryScope(value ?? defaultMemoryScope(ctx));
  const saveLabel = memoryScopeSaveLabel(selected, ctx);

  return (
    <div className={cn("space-y-1", className)}>
      {!compact && (
        <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
          Memory scope
        </label>
      )}
      <p className="text-[11px] font-medium text-ink-2">{saveLabel}</p>
      <select
        className="input-field h-8 w-full text-[11px]"
        value={selected}
        onChange={(e) => onChange(normalizeMemoryScope(e.target.value))}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
