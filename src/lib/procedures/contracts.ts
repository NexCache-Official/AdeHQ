/**
 * PR-25 Procedure contracts — governed, non-arbitrary executable units.
 * Only registered executorKeys may run; trustLevel core|verified are executable in V1.
 */

export type ProcedureTrustLevel = "core" | "verified" | "workspace" | "generated";

export type ProcedureRuntime = "node" | "worker";

export type ProcedureEngine =
  | "node_builtin"
  | "artifact_engine"
  | "worker_libreoffice"
  | "http_governed";

export type ProcedureNetwork = "none" | "allowlist";

export type ProcedureCategory =
  | "data"
  | "charts"
  | "quality"
  | "documents"
  | "presentations"
  | "spreadsheets"
  | "citations"
  | "bridges"
  | "general";

export type ProcedureManifest = {
  executorKey: string;
  name: string;
  description?: string;
  category: ProcedureCategory;
  version: number;
  trustLevel: ProcedureTrustLevel;
  runtime: ProcedureRuntime;
  engine: ProcedureEngine;
  permissions: string[];
  network: ProcedureNetwork;
  timeoutMs: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type ProcedureExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ProcedureBackpack = {
  procedureKey: string;
  procedureVersionId?: string;
  executorKey: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  engine: ProcedureEngine;
  permissions: string[];
  timeoutMs: number;
  network: ProcedureNetwork;
  workspaceId?: string;
  brainRunId?: string | null;
  playbookRunStepId?: string | null;
  idempotencyKey?: string;
};

export type ProcedureHandlerResult = {
  ok: boolean;
  output: Record<string, unknown>;
  errorCode?: string;
  safeErrorMessage?: string;
};

export type ProcedureHandler = (
  input: Record<string, unknown>,
  ctx: ProcedureExecutionContext,
) => Promise<ProcedureHandlerResult> | ProcedureHandlerResult;

export type ProcedureExecutionContext = {
  backpack: ProcedureBackpack;
  permissions: Set<string>;
  /** Injectable renderers for document/presentation/spreadsheet stubs. */
  renderers?: Record<string, (input: Record<string, unknown>) => Promise<unknown> | unknown>;
};
