import { isDriveArtifactAsk } from "@/lib/ai/detect-drive-artifact-ask";

/** Capacity / scheduling class for employee work items. */
export type WorkClass = "interactive" | "light_parallel" | "heavy_artifact";

const HEAVY_TOOLS =
  /^(artifact\.createSpreadsheet|artifact\.createPdfReport|artifact\.createDocx|artifact\.createPresentation|artifact\.convertFile|artifact\.updateSpreadsheet)$/i;

const LIGHT_TOOLS =
  /^(crm\.|tasks\.createTask|tasks\.updateTask|memory\.|calendar\.|email\.createDraft)/i;

export function isHeavyArtifactTool(toolName: string): boolean {
  return HEAVY_TOOLS.test(toolName.trim());
}

export function classifyWorkClass(input: {
  message?: string;
  toolName?: string;
  intent?: string;
}): WorkClass {
  if (input.toolName && isHeavyArtifactTool(input.toolName)) return "heavy_artifact";
  if (input.intent === "request_human_input" || input.intent === "brainstorm") {
    return "interactive";
  }
  if (input.toolName && LIGHT_TOOLS.test(input.toolName)) return "light_parallel";
  if (input.message && isDriveArtifactAsk(input.message)) return "heavy_artifact";
  return "interactive";
}

export const CAPACITY_LIMITS = {
  maxInteractiveRunning: Number(process.env.ADEHQ_MAX_INTERACTIVE_RUNNING ?? 1),
  maxInteractiveQueued: Number(process.env.ADEHQ_MAX_INTERACTIVE_QUEUED ?? 3),
  maxHeavyRunning: Number(process.env.ADEHQ_MAX_HEAVY_RUNNING ?? 2),
  maxLightParallel: Number(process.env.ADEHQ_MAX_LIGHT_PARALLEL ?? 2),
} as const;
