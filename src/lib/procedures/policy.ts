import type { ProcedureManifest } from "./contracts";
import { isExecutableTrustLevel } from "./validation";

export type ProcedurePolicyContext = {
  /** Explicit permission grants from the backpack / caller. */
  grantedPermissions?: string[] | Set<string>;
  /** Workspace role — admin | member only. */
  workspaceRole?: "admin" | "member";
  allowWorkspaceTrust?: boolean;
};

export type ProcedurePolicyResult = {
  allowed: boolean;
  reason?: string;
};

/**
 * Gate procedure execution: trustLevel + required permissions.
 * workspace/generated trust levels are not executable in V1 unless explicitly allowed.
 */
export function canExecuteProcedure(
  manifest: ProcedureManifest,
  ctx: ProcedurePolicyContext = {},
): ProcedurePolicyResult {
  if (!isExecutableTrustLevel(manifest.trustLevel)) {
    if (manifest.trustLevel === "workspace" && ctx.allowWorkspaceTrust) {
      // still require admin for workspace trust
      if (ctx.workspaceRole !== "admin") {
        return { allowed: false, reason: "workspace procedures require admin" };
      }
    } else {
      return {
        allowed: false,
        reason: `trustLevel ${manifest.trustLevel} is not executable`,
      };
    }
  }

  const granted = new Set(
    [...(ctx.grantedPermissions ?? [])].map((p) => String(p)),
  );
  for (const needed of manifest.permissions ?? []) {
    if (!granted.has(needed)) {
      return { allowed: false, reason: `missing permission: ${needed}` };
    }
  }

  return { allowed: true };
}
