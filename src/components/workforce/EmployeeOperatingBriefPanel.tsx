"use client";

import { useEffect, useMemo, useState } from "react";
import type { AIEmployee } from "@/lib/types";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { isMayaEmployee } from "@/lib/maya-employee";
import { MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import { Check, Pencil, ScrollText, X } from "lucide-react";

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

/** Turn packed hire briefs into readable paragraphs for display. */
export function formatInstructionsAsProse(value: string): string[] {
  const raw = value?.trim();
  if (!raw) return ["No standing instructions yet."];

  const normalized = raw
    .replace(
      /\s+(Role|Department|Domain|Mission|Seniority|Autonomy|Core responsibilities|Business focus|Communication style|Proactivity|Quality preference|Approval rules|Success metrics|Open questions):/gi,
      "\n$1:",
    )
    .replace(/\s+-\s+/g, "\n- ")
    .trim();

  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter(Boolean);

  if (lines.length <= 1 && !lines[0]?.includes(":")) {
    return [raw];
  }

  return lines.map((line) => {
    const match = line.match(/^([^:]{2,40}):\s*(.+)$/);
    if (!match) return line;
    return `${match[1]}: ${match[2]}`;
  });
}

export function EmployeeOperatingBriefPanel({ employee, onSave }: Props) {
  const locked = isMayaEmployee(employee);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

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
              : "Standing instructions the model follows. Edit anytime — saved changes apply on the next turn."}
          </p>
        </div>
        {!locked && !editing && (
          <Button size="sm" variant="secondary" onClick={startEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit instructions
          </Button>
        )}
        {!locked && editing && (
          <div className="flex flex-wrap gap-2">
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

      <div className="rounded-2xl border border-border bg-surface px-5 py-5">
        {editing && !locked ? (
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Standing instructions
              </span>
              <textarea
                className="input-field min-h-[200px] resize-y text-sm leading-relaxed"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="How should this employee approach work? Tone, priorities, what to avoid…"
                autoFocus
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block space-y-1.5 sm:col-span-1">
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
                <textarea
                  className="input-field min-h-[72px] resize-none"
                  value={communicationStyle}
                  onChange={(e) => setCommunicationStyle(e.target.value)}
                />
              </label>
              <label className="block space-y-1.5 sm:col-span-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Success criteria
                </span>
                <textarea
                  className="input-field min-h-[72px] resize-none"
                  value={successCriteria}
                  onChange={(e) => setSuccessCriteria(e.target.value)}
                />
              </label>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Standing instructions
            </p>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-2">
              {formatInstructionsAsProse(employee.instructions).map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
            <div className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
              <BriefMeta label="Communication" value={employee.communicationStyle} />
              <BriefMeta label="Success criteria" value={employee.successCriteria} />
              <BriefMeta label="Seniority" value={employee.seniority} />
            </div>
          </>
        )}

        {message && (
          <p
            className={cn(
              "mt-4 text-xs font-medium",
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
      <p className="mt-1 text-sm leading-relaxed text-ink-2">{value?.trim() || "—"}</p>
    </div>
  );
}
