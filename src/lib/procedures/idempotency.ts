import { createHash } from "crypto";
import { canonicalJson } from "@/lib/playbooks/checksum";

export function buildProcedureIdempotencyKey(parts: {
  workspaceId: string;
  executorKey: string;
  input: unknown;
  procedureVersion?: number | string;
}): string {
  const material = [
    parts.workspaceId,
    parts.executorKey,
    String(parts.procedureVersion ?? 1),
    canonicalJson(parts.input ?? {}),
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

export function hashProcedureInput(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input ?? {})).digest("hex");
}
