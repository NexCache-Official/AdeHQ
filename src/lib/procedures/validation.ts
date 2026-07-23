import type { ProcedureManifest } from "./contracts";
import { PROCEDURE_REGISTRY, resolveProcedureKey } from "./registry";

export type ProcedureValidationResult = {
  ok: boolean;
  errors: string[];
};

const TRUST = new Set(["core", "verified", "workspace", "generated"]);
const ENGINES = new Set([
  "node_builtin",
  "artifact_engine",
  "worker_libreoffice",
  "http_governed",
]);

export function validateProcedureManifest(manifest: unknown): ProcedureValidationResult {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, errors: ["manifest must be an object"] };
  }
  const m = manifest as Partial<ProcedureManifest>;
  if (!m.executorKey?.trim()) errors.push("executorKey is required");
  if (!m.name?.trim()) errors.push("name is required");
  if (!m.category) errors.push("category is required");
  if (!m.trustLevel || !TRUST.has(m.trustLevel)) errors.push("invalid trustLevel");
  if (!m.engine || !ENGINES.has(m.engine)) errors.push("invalid engine");
  if (!(typeof m.timeoutMs === "number") || m.timeoutMs <= 0) {
    errors.push("timeoutMs must be a positive number");
  }
  if (m.network !== "none" && m.network !== "allowlist") {
    errors.push("network must be none|allowlist");
  }
  if (!Array.isArray(m.permissions)) errors.push("permissions must be an array");
  return { ok: errors.length === 0, errors };
}

export function assertRegisteredProcedure(executorKey: string): ProcedureValidationResult {
  const resolved = resolveProcedureKey(executorKey);
  if (!PROCEDURE_REGISTRY[resolved]) {
    return {
      ok: false,
      errors: [`procedure not registered: ${executorKey}`],
    };
  }
  return validateProcedureManifest(PROCEDURE_REGISTRY[resolved]);
}

/** V1 executable trust levels only. */
export function isExecutableTrustLevel(trustLevel: string): boolean {
  return trustLevel === "core" || trustLevel === "verified";
}
