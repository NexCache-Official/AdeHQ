"use client";

import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { evaluateCondition } from "@/lib/hiring/workforce-studio/json-logic";
import type { TemplateSummary } from "@/lib/hiring/workforce-studio/client-api";

export function IntakeForm({
  template,
  answers,
  onAnswer,
  blueprintName,
  onNameChange,
  onBack,
  onSubmit,
  submitting,
}: {
  template: TemplateSummary;
  answers: Record<string, unknown>;
  onAnswer: (id: string, value: unknown) => void;
  blueprintName: string;
  onNameChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const visibleQuestions = useMemo(
    () =>
      template.intakeQuestions.filter((q) =>
        q.appliesWhen ? evaluateCondition(q.appliesWhen, { answers }) : true,
      ),
    [template.intakeQuestions, answers],
  );

  return (
    <div className="mx-auto w-full max-w-[640px]">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Choose a different starting point
      </button>

      <h1 className="mb-1 text-2xl font-semibold text-ink">{template.name}</h1>
      <p className="mb-6 text-[14px] text-ink-2">{template.description}</p>

      <Card className="space-y-5 p-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-3">Team name</span>
          <input
            value={blueprintName}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>

        {visibleQuestions.map((question) => (
          <div key={question.id} className="space-y-1.5">
            <span className="block text-xs font-medium text-ink-3">{question.prompt}</span>
            {question.type === "single_select" && question.options ? (
              <div className="flex flex-wrap gap-2">
                {question.options.map((opt) => {
                  const active = (answers[question.id] ?? question.defaultValue) === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onAnswer(question.id, opt.value)}
                      className={`rounded-full border px-3 py-1.5 text-[13px] transition ${
                        active
                          ? "border-accent bg-accent-soft text-accent-d"
                          : "border-border bg-surface text-ink-2 hover:border-ink/30"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            ) : question.type === "number" ? (
              <input
                type="number"
                value={(answers[question.id] as number | undefined) ?? (question.defaultValue as number) ?? 0}
                onChange={(e) => onAnswer(question.id, Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            ) : (
              <input
                value={(answers[question.id] as string | undefined) ?? ""}
                onChange={(e) => onAnswer(question.id, e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            )}
            {question.helpText ? <p className="text-[11px] text-ink-3">{question.helpText}</p> : null}
          </div>
        ))}
      </Card>

      <div className="mt-5 flex justify-end">
        <Button onClick={onSubmit} disabled={submitting || !blueprintName.trim()}>
          {submitting ? "Composing…" : "Compose the team →"}
        </Button>
      </div>
    </div>
  );
}
