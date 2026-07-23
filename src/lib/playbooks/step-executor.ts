import type { PlaybookStepDefinition, PlaybookStepKind } from "./contracts";

export type StepExecutorContext = {
  step: PlaybookStepDefinition;
  runInput: Record<string, unknown>;
  stepInputs: Record<string, unknown>;
  stepOutputs: Record<string, unknown>;
  roleEmployeeId: string | null;
  brainRunId: string | null;
  brainCapabilityStepId: string | null;
};

export type StepExecutorResult = {
  ok: boolean;
  kind: PlaybookStepKind;
  output: Record<string, unknown>;
  errorCode?: string;
  safeErrorMessage?: string;
};

export type StepKindHandlers = {
  procedure?: (
    ctx: StepExecutorContext,
  ) => Promise<StepExecutorResult> | StepExecutorResult;
  artifact_compose?: (
    ctx: StepExecutorContext,
  ) => Promise<StepExecutorResult> | StepExecutorResult;
  review?: (
    ctx: StepExecutorContext,
  ) => Promise<StepExecutorResult> | StepExecutorResult;
};

function placeholder(
  kind: PlaybookStepKind,
  ctx: StepExecutorContext,
  note: string,
): StepExecutorResult {
  return {
    ok: true,
    kind,
    output: {
      structured: true,
      placeholder: true,
      note,
      objective: ctx.step.objective,
      capability: ctx.step.capability,
      // Models produce structured content, never OOXML
      content: {
        schemaKey: ctx.step.artifactIntent?.schemaKey ?? "adehq.structured.v1",
        schemaVersion: ctx.step.artifactIntent?.schemaVersion ?? 1,
        summary: ctx.step.objective,
        blocks: [],
      },
    },
  };
}

/**
 * Dispatch a playbook step by kind.
 * procedure / artifact_compose / review use injectable handlers.
 * reasoning / search return structured V1 placeholders (no OOXML).
 */
export async function dispatchStepKind(
  kind: PlaybookStepKind,
  ctx: StepExecutorContext,
  handlers: StepKindHandlers = {},
): Promise<StepExecutorResult> {
  switch (kind) {
    case "reasoning":
      return placeholder("reasoning", ctx, "V1 reasoning placeholder — structured analysis only");
    case "search":
      return placeholder("search", ctx, "V1 search placeholder — structured findings only");
    case "procedure": {
      if (!handlers.procedure) {
        return {
          ok: false,
          kind,
          output: {},
          errorCode: "procedure_handler_missing",
          safeErrorMessage: "Procedure handler not configured",
        };
      }
      return handlers.procedure(ctx);
    }
    case "artifact_compose": {
      if (!handlers.artifact_compose) {
        return {
          ok: false,
          kind,
          output: {},
          errorCode: "artifact_compose_handler_missing",
          safeErrorMessage: "Artifact compose handler not configured",
        };
      }
      return handlers.artifact_compose(ctx);
    }
    case "review": {
      if (!handlers.review) {
        return {
          ok: false,
          kind,
          output: {},
          errorCode: "review_handler_missing",
          safeErrorMessage: "Review handler not configured",
        };
      }
      return handlers.review(ctx);
    }
    default: {
      const _exhaustive: never = kind;
      return {
        ok: false,
        kind: _exhaustive,
        output: {},
        errorCode: "unknown_step_kind",
        safeErrorMessage: "Unknown step kind",
      };
    }
  }
}
