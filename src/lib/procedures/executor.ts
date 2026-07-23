import type {
  ProcedureExecutionContext,
  ProcedureHandlerResult,
  ProcedureBackpack,
} from "./contracts";
import { canExecuteProcedure } from "./policy";
import { getProcedureHandler, getProcedureManifest } from "./registry";
import { assertRegisteredProcedure } from "./validation";

export type ExecuteProcedureOptions = {
  backpack?: Partial<ProcedureBackpack>;
  grantedPermissions?: string[];
  workspaceRole?: "admin" | "member";
  renderers?: ProcedureExecutionContext["renderers"];
};

/**
 * Execute a statically registered procedure by executorKey.
 * Unregistered keys and untrusted levels fail closed — no arbitrary code.
 */
export async function executeProcedure(
  executorKey: string,
  input: Record<string, unknown>,
  opts: ExecuteProcedureOptions = {},
): Promise<ProcedureHandlerResult> {
  const registered = assertRegisteredProcedure(executorKey);
  if (!registered.ok) {
    return {
      ok: false,
      output: {},
      errorCode: "procedure_not_registered",
      safeErrorMessage: registered.errors.join("; "),
    };
  }

  const manifest = getProcedureManifest(executorKey)!;
  const policy = canExecuteProcedure(manifest, {
    grantedPermissions: opts.grantedPermissions ?? manifest.permissions,
    workspaceRole: opts.workspaceRole,
  });
  if (!policy.allowed) {
    return {
      ok: false,
      output: {},
      errorCode: "procedure_untrusted",
      safeErrorMessage: policy.reason ?? "Procedure execution not allowed",
    };
  }

  const handler = getProcedureHandler(executorKey);
  if (!handler) {
    return {
      ok: false,
      output: {},
      errorCode: "procedure_handler_missing",
      safeErrorMessage: "No handler for procedure",
    };
  }

  const backpack: ProcedureBackpack = {
    procedureKey: executorKey,
    executorKey,
    inputSchema: manifest.inputSchema ?? {},
    outputSchema: manifest.outputSchema ?? {},
    engine: manifest.engine,
    permissions: manifest.permissions,
    timeoutMs: manifest.timeoutMs,
    network: manifest.network,
    ...opts.backpack,
  };

  const ctx: ProcedureExecutionContext = {
    backpack,
    permissions: new Set(backpack.permissions),
    renderers: opts.renderers,
  };

  return handler(input, ctx);
}
