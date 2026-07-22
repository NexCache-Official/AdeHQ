"use client";

import { CheckCircle2, Loader2, XCircle, Circle } from "lucide-react";
import { Card, Button } from "@/components/ui";
import type { TeamHirePlanRecord, TeamHirePlanStep } from "@/lib/hiring/workforce-studio/types";

const STEP_LABEL: Record<string, string> = {
  create_room: "Create room",
  create_employee: "Hire AI employee",
  grant_tools: "Grant tool access",
  add_room_member: "Add to room",
  create_collaboration_edge: "Link collaboration",
  create_outcome_task: "Create outcome task",
  create_artifact: "Generate artifact",
  first_mission_task: "First mission task",
  first_mission_message: "Welcome message",
};

export function ProvisioningView({
  plan,
  steps,
  error,
  onDone,
}: {
  plan: TeamHirePlanRecord | null;
  steps: TeamHirePlanStep[];
  error: string | null;
  onDone: () => void;
}) {
  if (!plan) return null;
  const done = plan.status === "completed";
  const failed = ["failed", "compensated", "cancelled"].includes(plan.status);
  const progress = plan.totalSteps > 0 ? Math.round((plan.completedSteps / plan.totalSteps) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div className="mb-6 text-center">
        {done ? (
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green" />
        ) : failed ? (
          <XCircle className="mx-auto mb-3 h-10 w-10 text-danger" />
        ) : (
          <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-accent" />
        )}
        <h1 className="text-2xl font-semibold text-ink">
          {done ? "Your team is live" : failed ? "Provisioning rolled back" : "Building your team…"}
        </h1>
        <p className="mt-1 text-[13px] text-ink-2">
          {done
            ? "Seats, rooms, and first-mission tasks are ready."
            : failed
              ? error ?? "Something went wrong. No partial team was left behind."
              : `${plan.completedSteps} of ${plan.totalSteps} steps complete`}
        </p>
      </div>

      <Card className="p-4">
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
        <ul className="max-h-[360px] space-y-1.5 overflow-y-auto">
          {steps.map((step) => (
            <li key={step.id} className="flex items-center gap-2 text-[13px]">
              {step.status === "succeeded" ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green" />
              ) : step.status === "failed" ? (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-danger" />
              ) : step.status === "compensated" ? (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-ink-3" />
              ) : step.status === "running" ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0 text-ink-3/40" />
              )}
              <span className={step.status === "compensated" ? "text-ink-3 line-through" : "text-ink-2"}>
                {STEP_LABEL[step.stepType] ?? step.stepType}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {(done || failed) && (
        <div className="mt-5 flex justify-center">
          <Button onClick={onDone}>{done ? "Go to workspace" : "Back to templates"}</Button>
        </div>
      )}
    </div>
  );
}
