"use client";

import { useMemo, useState } from "react";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { PlaybookDefinitionV1, PlaybookInputDefinition } from "@/lib/playbooks/contracts";
import { ArrowLeft, ArrowRight, Play, Loader2 } from "lucide-react";

const STAGES = [
  { id: "outcome", label: "Outcome" },
  { id: "inputs", label: "Inputs" },
  { id: "team", label: "Team" },
  { id: "outputs", label: "Outputs" },
  { id: "review", label: "Review" },
  { id: "run", label: "Run" },
] as const;

type StageId = (typeof STAGES)[number]["id"];

export type PlaybookRunWizardProps = {
  definition: PlaybookDefinitionV1;
  estimate?: {
    estimatedWhMin: number;
    estimatedWhMax: number;
    hardWhLimit: number;
  } | null;
  employees?: Array<{ id: string; name: string; role?: string }>;
  onRun: (payload: {
    inputPayload: Record<string, unknown>;
    selectedEmployeeIds: string[];
  }) => Promise<void> | void;
  running?: boolean;
  className?: string;
};

export function PlaybookRunWizard({
  definition,
  estimate,
  employees = [],
  onRun,
  running,
  className,
}: PlaybookRunWizardProps) {
  const [stageIdx, setStageIdx] = useState(0);
  const stage = STAGES[stageIdx].id as StageId;
  const [inputs, setInputs] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const field of definition.inputs) {
      if (field.defaultValue !== undefined) init[field.key] = field.defaultValue;
    }
    return init;
  });
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);

  const missingRequired = useMemo(() => {
    return definition.inputs
      .filter((f) => f.required)
      .filter((f) => {
        const v = inputs[f.key];
        return v === undefined || v === null || String(v).trim() === "";
      });
  }, [definition.inputs, inputs]);

  const canNext =
    stage !== "inputs" || missingRequired.length === 0;

  const toggleEmployee = (id: string) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const renderInput = (field: PlaybookInputDefinition) => {
    const value = String(inputs[field.key] ?? "");
    if (field.type === "boolean") {
      return (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={Boolean(inputs[field.key])}
            onChange={(e) =>
              setInputs((prev) => ({ ...prev, [field.key]: e.target.checked }))
            }
          />
          {field.label ?? field.key}
        </label>
      );
    }
    if (field.type === "enum" && field.enumValues?.length) {
      return (
        <select
          className="input-field"
          value={value}
          onChange={(e) =>
            setInputs((prev) => ({ ...prev, [field.key]: e.target.value }))
          }
        >
          <option value="">Select…</option>
          {field.enumValues.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
    if (field.type === "text" || field.type === "json") {
      return (
        <textarea
          className="input-field min-h-[88px]"
          value={value}
          onChange={(e) =>
            setInputs((prev) => ({ ...prev, [field.key]: e.target.value }))
          }
          placeholder={field.description}
        />
      );
    }
    return (
      <input
        className="input-field"
        type={field.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) =>
          setInputs((prev) => ({
            ...prev,
            [field.key]: field.type === "number" ? Number(e.target.value) : e.target.value,
          }))
        }
        placeholder={field.description}
      />
    );
  };

  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {STAGES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStageIdx(i)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
              i === stageIdx
                ? "bg-accent text-white"
                : i < stageIdx
                  ? "bg-accent-soft text-accent"
                  : "bg-panel-2 text-ink-3",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {stage === "outcome" && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">{definition.name}</h3>
          <p className="text-sm text-ink-2">{definition.description}</p>
          <p className="text-xs text-ink-3">
            Category: {definition.category} · {definition.steps.length} steps ·{" "}
            {definition.roleRequirements.length} roles
          </p>
        </div>
      )}

      {stage === "inputs" && (
        <div className="space-y-3">
          {definition.inputs.length === 0 ? (
            <p className="text-sm text-ink-3">No inputs required.</p>
          ) : (
            definition.inputs.map((field) => (
              <label key={field.key} className="block space-y-1.5">
                <span className="text-xs font-medium text-ink-3">
                  {field.label ?? field.key}
                  {field.required ? " *" : ""}
                </span>
                {renderInput(field)}
              </label>
            ))
          )}
          {missingRequired.length > 0 && (
            <p className="text-xs text-rose-500">Fill required fields to continue.</p>
          )}
        </div>
      )}

      {stage === "team" && (
        <div className="space-y-2">
          <p className="text-sm text-ink-2">
            Roles needed:{" "}
            {definition.roleRequirements.map((r) => r.roleKey).join(", ") || "none"}
          </p>
          {employees.length === 0 ? (
            <p className="text-xs text-ink-3">
              No employees listed — run will proceed without pre-assignments.
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {employees.map((emp) => (
                <li key={emp.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-panel-2">
                    <input
                      type="checkbox"
                      checked={selectedEmployeeIds.includes(emp.id)}
                      onChange={() => toggleEmployee(emp.id)}
                    />
                    <span className="text-sm text-ink">{emp.name}</span>
                    {emp.role && (
                      <span className="text-[11px] text-ink-3">{emp.role}</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {stage === "outputs" && (
        <ul className="space-y-2">
          {definition.outputs.map((out) => (
            <li
              key={out.key}
              className="rounded-lg border border-border px-3 py-2 text-sm text-ink-2"
            >
              <span className="font-medium text-ink">{out.key}</span>
              <span className="text-ink-3"> · {out.kind}</span>
              {out.description && (
                <p className="mt-0.5 text-xs text-ink-3">{out.description}</p>
              )}
            </li>
          ))}
          {!definition.outputs.length && (
            <p className="text-sm text-ink-3">No declared outputs.</p>
          )}
        </ul>
      )}

      {stage === "review" && (
        <div className="space-y-2 text-sm text-ink-2">
          <p>
            Estimated WH:{" "}
            <span className="font-mono text-ink">
              {estimate?.estimatedWhMin ?? "—"}–{estimate?.estimatedWhMax ?? "—"}
            </span>
            {estimate?.hardWhLimit != null && (
              <span className="text-ink-3"> (hard cap {estimate.hardWhLimit})</span>
            )}
          </p>
          <p>Selected teammates: {selectedEmployeeIds.length || "auto / none"}</p>
          <p>Inputs set: {Object.keys(inputs).length}</p>
        </div>
      )}

      {stage === "run" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Start this playbook. You can stop the run from the progress view.
          </p>
          <Button
            onClick={() => onRun({ inputPayload: inputs, selectedEmployeeIds })}
            disabled={running || missingRequired.length > 0}
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Start run
          </Button>
        </div>
      )}

      <div className="mt-6 flex justify-between">
        <Button
          size="sm"
          variant="ghost"
          disabled={stageIdx === 0}
          onClick={() => setStageIdx((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
        {stage !== "run" && (
          <Button
            size="sm"
            disabled={!canNext}
            onClick={() => setStageIdx((i) => Math.min(STAGES.length - 1, i + 1))}
          >
            Next <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </Card>
  );
}
