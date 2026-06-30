"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AiEmployeeJobBrief, RefineMode } from "@/lib/hiring/types";

type ListKey =
  | "coreResponsibilities"
  | "successMetrics"
  | "approvalRules"
  | "technicalFocus"
  | "toolsNeeded";

function EditableBullets({
  items,
  editable,
  onChange,
  onAdd,
  onRemove,
  onMove,
}: {
  items: string[];
  editable: boolean;
  onChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-2 text-ink/25">•</span>
          {editable ? (
            <>
              <input
                value={item}
                onChange={(e) => onChange(i, e.target.value)}
                className="flex-1 border-none bg-transparent text-[14px] leading-relaxed outline-none focus:ring-0"
              />
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => onMove(i, -1)}
                  disabled={i === 0}
                  className="text-xs text-ink-3 hover:text-ink disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onMove(i, 1)}
                  disabled={i === items.length - 1}
                  className="text-xs text-ink-3 hover:text-ink disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="text-xs text-ink-3 hover:text-danger"
                >
                  ×
                </button>
              </div>
            </>
          ) : (
            <span className="text-[14px] leading-relaxed">{item}</span>
          )}
        </div>
      ))}
      {editable && (
        <button
          type="button"
          onClick={onAdd}
          className="text-[13px] font-medium text-accent hover:text-accent-d"
        >
          + Add bullet
        </button>
      )}
    </div>
  );
}

export function BriefEditor({
  brief,
  editable,
  onChange,
  onRefineSection,
  busy,
}: {
  brief: AiEmployeeJobBrief;
  editable: boolean;
  onChange: (b: AiEmployeeJobBrief) => void;
  onRefineSection: (
    section: string,
    mode: RefineMode,
    instruction?: string,
  ) => Promise<void>;
  busy?: boolean;
}) {
  const [undo, setUndo] = useState<{ section: string; snapshot: AiEmployeeJobBrief } | null>(null);

  const patchList = (key: ListKey, fn: (list: string[]) => string[]) => {
    onChange({ ...brief, [key]: fn(brief[key] ?? []) });
  };

  const sectionActions = (section: string, listKey?: ListKey) => (
    <div className="mb-2 flex flex-wrap gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setUndo({ section, snapshot: { ...brief } });
          await onRefineSection(section, "regenerate");
          setTimeout(() => setUndo(null), 8000);
        }}
        className="text-[11px] text-ink-3 hover:text-ink disabled:opacity-40"
      >
        Regenerate
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setUndo({ section, snapshot: { ...brief } });
          await onRefineSection(section, "improve");
          setTimeout(() => setUndo(null), 8000);
        }}
        className="text-[11px] text-ink-3 hover:text-ink disabled:opacity-40"
      >
        Improve
      </button>
      {undo?.section === section && (
        <button
          type="button"
          onClick={() => {
            onChange(undo.snapshot);
            setUndo(null);
          }}
          className="text-[11px] font-medium text-accent"
        >
          Undo
        </button>
      )}
    </div>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
      <div className="border-b border-border bg-gradient-to-b from-muted/80 to-surface px-7 py-6">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
          Role title
        </div>
        {editable ? (
          <input
            value={brief.roleTitle}
            onChange={(e) => onChange({ ...brief, roleTitle: e.target.value })}
            className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none"
          />
        ) : (
          <h2 className="text-2xl font-semibold tracking-tight">{brief.roleTitle}</h2>
        )}
        <p className="mt-1 text-sm text-ink-2">{brief.domain}</p>
      </div>

      <div className="px-7 pb-6">
        <div className="border-b border-border/60 py-5">
          {sectionActions("mission")}
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">Mission</div>
          {editable ? (
            <textarea
              value={brief.mission}
              onChange={(e) => onChange({ ...brief, mission: e.target.value })}
              rows={3}
              className="w-full resize-none bg-transparent font-serif text-lg italic leading-relaxed outline-none"
            />
          ) : (
            <p className="font-serif text-lg italic leading-relaxed">{brief.mission}</p>
          )}
        </div>

        <div className="border-b border-border/60 py-5">
          {sectionActions("coreResponsibilities", "coreResponsibilities")}
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Core responsibilities
          </div>
          <EditableBullets
            items={brief.coreResponsibilities}
            editable={editable}
            onChange={(i, v) =>
              patchList("coreResponsibilities", (list) => {
                const next = [...list];
                next[i] = v;
                return next;
              })
            }
            onAdd={() => patchList("coreResponsibilities", (l) => [...l, "New responsibility"])}
            onRemove={(i) => patchList("coreResponsibilities", (l) => l.filter((_, j) => j !== i))}
            onMove={(i, dir) =>
              patchList("coreResponsibilities", (l) => {
                const next = [...l];
                const j = i + dir;
                if (j < 0 || j >= next.length) return next;
                [next[i], next[j]] = [next[j], next[i]];
                return next;
              })
            }
          />
        </div>

        <div className="border-b border-border/60 py-5">
          {sectionActions("technicalFocus", "technicalFocus")}
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Technical focus
          </div>
          <EditableBullets
            items={brief.technicalFocus}
            editable={editable}
            onChange={(i, v) =>
              patchList("technicalFocus", (list) => {
                const next = [...list];
                next[i] = v;
                return next;
              })
            }
            onAdd={() => patchList("technicalFocus", (l) => [...l, "New focus area"])}
            onRemove={(i) => patchList("technicalFocus", (l) => l.filter((_, j) => j !== i))}
            onMove={(i, dir) =>
              patchList("technicalFocus", (l) => {
                const next = [...l];
                const j = i + dir;
                if (j < 0 || j >= next.length) return next;
                [next[i], next[j]] = [next[j], next[i]];
                return next;
              })
            }
          />
        </div>

        <div className="border-b border-border/60 py-5">
          {sectionActions("successMetrics", "successMetrics")}
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Success metrics
          </div>
          <EditableBullets
            items={brief.successMetrics}
            editable={editable}
            onChange={(i, v) =>
              patchList("successMetrics", (list) => {
                const next = [...list];
                next[i] = v;
                return next;
              })
            }
            onAdd={() => patchList("successMetrics", (l) => [...l, "New success metric"])}
            onRemove={(i) => patchList("successMetrics", (l) => l.filter((_, j) => j !== i))}
            onMove={(i, dir) =>
              patchList("successMetrics", (l) => {
                const next = [...l];
                const j = i + dir;
                if (j < 0 || j >= next.length) return next;
                [next[i], next[j]] = [next[j], next[i]];
                return next;
              })
            }
          />
        </div>

        <div className="border-b border-border/60 py-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Communication style
          </div>
          {editable ? (
            <input
              value={brief.communicationStyle}
              onChange={(e) => onChange({ ...brief, communicationStyle: e.target.value })}
              className="w-full bg-transparent text-[14px] outline-none"
            />
          ) : (
            <p className="text-[14px]">{brief.communicationStyle}</p>
          )}
        </div>

        <div className="grid gap-4 border-b border-border/60 py-5 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-ink-3">
              Seniority
            </span>
            <select
              value={brief.seniorityLevel}
              disabled={!editable}
              onChange={(e) =>
                onChange({
                  ...brief,
                  seniorityLevel: e.target.value as AiEmployeeJobBrief["seniorityLevel"],
                })
              }
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
            >
              {(["assistant", "specialist", "manager", "director", "advisor"] as const).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-ink-3">
              Autonomy
            </span>
            <select
              value={brief.autonomyLevel}
              disabled={!editable}
              onChange={(e) =>
                onChange({
                  ...brief,
                  autonomyLevel: e.target.value as AiEmployeeJobBrief["autonomyLevel"],
                })
              }
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
            >
              {(["low", "balanced", "high"] as const).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="py-5">
          {sectionActions("approvalRules", "approvalRules")}
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Approval rules
          </div>
          <EditableBullets
            items={brief.approvalRules}
            editable={editable}
            onChange={(i, v) =>
              patchList("approvalRules", (list) => {
                const next = [...list];
                next[i] = v;
                return next;
              })
            }
            onAdd={() => patchList("approvalRules", (l) => [...l, "New approval rule"])}
            onRemove={(i) => patchList("approvalRules", (l) => l.filter((_, j) => j !== i))}
            onMove={(i, dir) =>
              patchList("approvalRules", (l) => {
                const next = [...l];
                const j = i + dir;
                if (j < 0 || j >= next.length) return next;
                [next[i], next[j]] = [next[j], next[i]];
                return next;
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
