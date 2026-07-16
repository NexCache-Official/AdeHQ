"use client";

import { useMemo, useState } from "react";
import type { AIEmployee } from "@/lib/types";
import {
  applyIntelligencePolicyUpdate,
  BROWSER_ACCESS_LABELS,
  BROWSER_ACCESS_OPTIONS,
  BRAIN_INTELLIGENCE_MODE_OPTIONS,
  formatIntelligencePolicyLines,
  INTELLIGENCE_MODE_LABELS,
  LEGACY_INTELLIGENCE_MODE_OPTIONS,
  resolveEmployeeIntelligencePolicy,
  ROUTING_PREFERENCE_LABELS,
  ROUTING_PREFERENCE_OPTIONS,
  WORK_HOUR_PROFILE_LABELS,
  WORK_HOUR_PROFILE_OPTIONS,
  type BrowserAccess,
  type IntelligenceMode,
  type RoutingPreference,
  type WorkHourProfile,
} from "@/lib/ai/intelligence-policy";
import { Card, Button } from "@/components/ui";
import { Brain } from "lucide-react";

/** Client-safe Brain UX: default Auto. Kill switch via NEXT_PUBLIC_ADEHQ_BRAIN_V1=0. */
function brainV1UiEnabled(): boolean {
  const env = process.env.NEXT_PUBLIC_ADEHQ_BRAIN_V1?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off") return false;
  return true;
}

export function EmployeeIntelligencePanel({
  employee,
  editable = false,
  onSave,
  /** Admin diagnostics may pass true to show legacy Efficient/Balanced/Strong. */
  showLegacyModes = false,
}: {
  employee: AIEmployee;
  editable?: boolean;
  onSave?: (patch: ReturnType<typeof applyIntelligencePolicyUpdate>) => void;
  showLegacyModes?: boolean;
}) {
  const brainOn = brainV1UiEnabled() && !showLegacyModes;
  const policy = useMemo(() => resolveEmployeeIntelligencePolicy(employee), [employee]);
  const lines = useMemo(() => formatIntelligencePolicyLines(policy), [policy]);
  const [draft, setDraft] = useState(() =>
    brainOn ? { ...policy, defaultMode: "auto" as IntelligenceMode } : policy,
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const modeOptions = brainOn ? BRAIN_INTELLIGENCE_MODE_OPTIONS : LEGACY_INTELLIGENCE_MODE_OPTIONS;

  const save = () => {
    onSave?.(applyIntelligencePolicyUpdate(employee, draft));
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Brain className="h-4 w-4 text-accent-600" />
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Intelligence</h2>
          <p className="text-xs text-slate-500">
            How AdeHQ routes this employee&apos;s AI work — not raw provider settings.
          </p>
        </div>
      </div>

      {!editable ? (
        <dl className="space-y-3">
          {(brainOn
            ? lines.map((line) =>
                line.label === "Intelligence"
                  ? {
                      label: line.label,
                      value: "Auto — AdeHQ picks the brain per task",
                    }
                  : line,
              )
            : lines
          ).map((line) => (
            <div key={line.label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{line.label}</dt>
              <dd className="mt-1 text-sm text-slate-700">{line.value}</dd>
            </div>
          ))}
          {brainOn ? (
            <p className="pt-1 text-xs text-slate-500">
              Chat intensity chips (Fast / Standard / Deep / Research) set budget and depth only — never a model SKU.
            </p>
          ) : null}
        </dl>
      ) : (
        <div className="space-y-4">
          <FieldSelect
            label="Default intelligence"
            value={(brainOn ? "auto" : draft.defaultMode) as IntelligenceMode}
            options={modeOptions.map((value) => ({
              value,
              label: INTELLIGENCE_MODE_LABELS[value],
            }))}
            onChange={(value) =>
              setDraft((current) => ({ ...current, defaultMode: value as IntelligenceMode }))
            }
          />
          {brainOn ? (
            <p className="text-xs text-slate-500">
              Auto — AdeHQ assembles the right brain for each task. Intensity chips in chat
              set budget/depth only, never a model.
            </p>
          ) : null}
          <FieldSelect
            label="Routing preference"
            value={draft.routingPreference as RoutingPreference}
            options={ROUTING_PREFERENCE_OPTIONS.map((value) => ({
              value,
              label: ROUTING_PREFERENCE_LABELS[value],
            }))}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                routingPreference: value as RoutingPreference,
              }))
            }
          />
          <FieldSelect
            label="Work profile"
            value={draft.workHourProfile as WorkHourProfile}
            options={WORK_HOUR_PROFILE_OPTIONS.map((value) => ({
              value,
              label: WORK_HOUR_PROFILE_LABELS[value],
            }))}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                workHourProfile: value as WorkHourProfile,
              }))
            }
          />
          <FieldSelect
            label="Browser access"
            value={draft.browserAccess as BrowserAccess}
            options={BROWSER_ACCESS_OPTIONS.map((value) => ({
              value,
              label: BROWSER_ACCESS_LABELS[value],
            }))}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                browserAccess: value as BrowserAccess,
              }))
            }
          />
          <button
            type="button"
            className="text-xs text-slate-500 underline-offset-2 hover:underline"
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            {advancedOpen ? "Hide advanced routing details" : "Show advanced routing details"}
          </button>
          {advancedOpen && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p>Legacy model override: {employee.model || "role default"}</p>
              <p className="mt-1">Provider fallback: {employee.provider === "mock" ? "Simulated" : "Live AI"}</p>
            </div>
          )}
          {onSave && (
            <Button size="sm" onClick={save}>
              Save intelligence policy
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function FieldSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select className="input-field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
