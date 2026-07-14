"use client";

import { useEffect, useMemo, useState } from "react";
import type { AIEmployee } from "@/lib/types";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { isMayaEmployee } from "@/lib/maya-employee";
import { MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import { Check, Eye, Pencil, ScrollText, X } from "lucide-react";

type BriefPatch = {
  instructions: string;
  communicationStyle: string;
  successCriteria: string;
  seniority: string;
  name?: string;
  role?: string;
};

type Props = {
  employee: AIEmployee;
  onSave: (patch: BriefPatch) => void | Promise<void>;
};

type BriefBlock =
  | { kind: "kv"; label: string; value: string }
  | { kind: "heading"; label: string }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "empty" };

const KNOWN_LABELS =
  "Role|Department|Domain|Mission|Seniority|Autonomy|Core responsibilities|Technical focus|Business focus|Communication style|Proactivity|Quality preference|Approval rules|Success metrics|Assumptions|Open questions";

/**
 * Normalize packed hire briefs and freeform notes into document blocks
 * so titles, key/value rows, and bullets render with real hierarchy.
 */
export function parseInstructionsDocument(value: string): BriefBlock[] {
  const raw = value?.trim();
  if (!raw) return [{ kind: "paragraph", text: "No standing instructions yet." }];

  const normalized = raw
    .replace(new RegExp(`\\s+(${KNOWN_LABELS}):`, "gi"), "\n$1:")
    .replace(/\r\n/g, "\n")
    .replace(/\s+-\s+/g, "\n- ")
    .trim();

  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\t/g, "  ").trimEnd())
    .filter((line, index, arr) => {
      // Keep single blank lines as section breaks; collapse runs of blanks.
      if (line.trim()) return true;
      return index > 0 && Boolean(arr[index - 1]?.trim());
    });

  const blocks: BriefBlock[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push({ kind: "empty" });
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      blocks.push({ kind: "bullet", text: bullet[1].trim() });
      continue;
    }

    // Section heading only: "Core responsibilities:"
    const headingOnly = trimmed.match(/^([^:]{2,48}):\s*$/);
    if (headingOnly) {
      blocks.push({ kind: "heading", label: headingOnly[1].trim() });
      continue;
    }

    // Key / value: "Mission: Drive top-of-funnel…"
    const kv = trimmed.match(/^([^:]{2,48}):\s+(.+)$/);
    if (kv) {
      blocks.push({ kind: "kv", label: kv[1].trim(), value: kv[2].trim() });
      continue;
    }

    blocks.push({ kind: "paragraph", text: trimmed });
  }

  return blocks.length ? blocks : [{ kind: "paragraph", text: raw }];
}

export function BriefDocumentView({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const blocks = useMemo(() => parseInstructionsDocument(value), [value]);

  return (
    <div
      className={cn(
        "prose-brief max-w-none space-y-3 text-[15px] leading-[1.65] text-ink-2",
        className,
      )}
    >
      {blocks.map((block, index) => {
        if (block.kind === "empty") {
          return <div key={`gap-${index}`} className="h-2" aria-hidden />;
        }
        if (block.kind === "heading") {
          return (
            <h3
              key={`h-${index}`}
              className="pt-2 text-[13px] font-semibold tracking-tight text-ink first:pt-0"
            >
              {block.label}
            </h3>
          );
        }
        if (block.kind === "kv") {
          return (
            <p key={`kv-${index}`} className="m-0">
              <span className="font-semibold text-ink">{block.label}</span>
              <span className="text-ink-3"> · </span>
              <span className="text-ink-2">{block.value}</span>
            </p>
          );
        }
        if (block.kind === "bullet") {
          return (
            <div key={`b-${index}`} className="flex gap-2.5 pl-0.5">
              <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />
              <p className="m-0 min-w-0 flex-1 text-ink-2">{block.text}</p>
            </div>
          );
        }
        return (
          <p key={`p-${index}`} className="m-0 text-ink-2">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

export function EmployeeOperatingBriefPanel({ employee, onSave }: Props) {
  const locked = isMayaEmployee(employee);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  const [instructions, setInstructions] = useState(employee.instructions);
  const [communicationStyle, setCommunicationStyle] = useState(employee.communicationStyle);
  const [successCriteria, setSuccessCriteria] = useState(employee.successCriteria);
  const [seniority, setSeniority] = useState(employee.seniority);

  useEffect(() => {
    if (editing) return;
    setInstructions(employee.instructions);
    setCommunicationStyle(employee.communicationStyle);
    setSuccessCriteria(employee.successCriteria);
    setSeniority(employee.seniority);
  }, [employee, editing]);

  const dirty = useMemo(() => {
    return (
      instructions !== employee.instructions ||
      communicationStyle !== employee.communicationStyle ||
      successCriteria !== employee.successCriteria ||
      seniority !== employee.seniority
    );
  }, [instructions, communicationStyle, successCriteria, seniority, employee]);

  const startEdit = () => {
    if (locked) return;
    setInstructions(employee.instructions);
    setCommunicationStyle(employee.communicationStyle);
    setSuccessCriteria(employee.successCriteria);
    setSeniority(employee.seniority);
    setMessage(null);
    setMessageIsError(false);
    setShowPreview(true);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setInstructions(employee.instructions);
    setCommunicationStyle(employee.communicationStyle);
    setSuccessCriteria(employee.successCriteria);
    setSeniority(employee.seniority);
    setMessage(null);
    setMessageIsError(false);
  };

  const save = async () => {
    if (locked) return;
    setSaving(true);
    setMessage(null);
    setMessageIsError(false);
    try {
      await onSave({
        instructions: instructions.trim(),
        communicationStyle: communicationStyle.trim(),
        successCriteria: successCriteria.trim(),
        seniority: seniority.trim() || employee.seniority,
      });
      setEditing(false);
      setMessage("Operating brief saved. This employee will use it on the next turn.");
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "Could not save brief.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ScrollText className="h-4 w-4 text-accent" />
            Operating brief
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">
            {locked
              ? `${MAYA_EMPLOYEE_NAME}'s instructions are fixed by the product and cannot be changed.`
              : "Standing instructions the model follows. Edit anytime — use Title: value lines and bullets for clear structure."}
          </p>
        </div>
        {!locked && !editing && (
          <Button size="sm" variant="secondary" onClick={startEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit instructions
          </Button>
        )}
        {!locked && editing && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => setShowPreview((v) => !v)}
            >
              <Eye className="h-3.5 w-3.5" />
              {showPreview ? "Hide preview" : "Show preview"}
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={cancel}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
            <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
              <Check className="h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save brief"}
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {editing && !locked ? (
          <div className="grid lg:grid-cols-2">
            <div className="border-b border-border lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Editor
                </span>
                <span className="text-[11px] text-ink-3">Plain text · Title: value · - bullets</span>
              </div>
              <textarea
                className="min-h-[340px] w-full resize-y border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:ring-0"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={
                  "Role: Sales Development Rep\nMission: Qualify inbound leads\n\nCore responsibilities:\n- Research accounts\n- Draft outreach"
                }
                spellCheck
                autoFocus
              />
              <div className="space-y-3 border-t border-border px-5 py-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                      Seniority
                    </span>
                    <input
                      className="input-field"
                      value={seniority}
                      onChange={(e) => setSeniority(e.target.value)}
                      placeholder="e.g. Senior"
                    />
                  </label>
                  <label className="block space-y-1.5 sm:col-span-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                      Communication style
                    </span>
                    <input
                      className="input-field"
                      value={communicationStyle}
                      onChange={(e) => setCommunicationStyle(e.target.value)}
                    />
                  </label>
                </div>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                    Success criteria
                  </span>
                  <textarea
                    className="input-field min-h-[64px] resize-none"
                    value={successCriteria}
                    onChange={(e) => setSuccessCriteria(e.target.value)}
                  />
                </label>
              </div>
            </div>

            {showPreview && (
              <div className="bg-muted/20">
                <div className="flex items-center border-b border-border bg-muted/40 px-4 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                    Preview
                  </span>
                </div>
                <div className="max-h-[520px] overflow-y-auto px-5 py-5">
                  <BriefDocumentView value={instructions} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="px-5 py-5 sm:px-6 sm:py-6">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Standing instructions
            </p>
            <BriefDocumentView value={employee.instructions} />
            <div className="mt-8 grid gap-5 border-t border-border pt-5 sm:grid-cols-3">
              <BriefMeta label="Communication" value={employee.communicationStyle} />
              <BriefMeta label="Success criteria" value={employee.successCriteria} />
              <BriefMeta label="Seniority" value={employee.seniority} />
            </div>
          </div>
        )}

        {message && (
          <p
            className={cn(
              "border-t border-border px-5 py-3 text-xs font-medium",
              messageIsError ? "text-rose-600" : "text-emerald-700",
            )}
          >
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

function BriefMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{value?.trim() || "—"}</p>
    </div>
  );
}
