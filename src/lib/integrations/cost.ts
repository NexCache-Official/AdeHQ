// ===========================================================================
// Tool run cost hooks — every integration_tool_run records cost_usd and
// work_minutes, even when zero. Centralized here so the Super Admin cost
// dashboard is accurate from day one and Phase 4 adapters just add rows.
// ===========================================================================

import { estimateWorkMinutesFromCost } from "@/lib/ai/work-hours/estimate";
import type { ToolCallMode } from "./types";

export type ToolRunCostEstimate = {
  costUsd: number;
  workMinutes: number;
};

/**
 * Baseline per-tool estimates. Internal CRUD is free and near-instant;
 * model inference for drafting is attributed separately via ai_usage_events.
 * Async artifact/external tools carry real costs (Phase 2/4).
 */
const TOOL_COST_TABLE: Record<string, ToolRunCostEstimate> = {
  "crm.createContact": { costUsd: 0, workMinutes: 0 },
  "crm.createCompany": { costUsd: 0, workMinutes: 0 },
  "crm.createDeal": { costUsd: 0, workMinutes: 0 },
  "crm.updateDealStage": { costUsd: 0, workMinutes: 0 },
  "crm.listContacts": { costUsd: 0, workMinutes: 0 },
  "crm.listDeals": { costUsd: 0, workMinutes: 0 },
  "email.createDraft": { costUsd: 0, workMinutes: 0.1 },
  "tasks.createTask": { costUsd: 0, workMinutes: 0 },
  // Phase 2 async artifacts — placeholder estimates until worker reports actuals.
  "artifact.createSpreadsheet": { costUsd: 0.002, workMinutes: 1 },
  "artifact.createPdfReport": { costUsd: 0.005, workMinutes: 2 },
};

export function estimateToolRunCost(toolName: string, mode: ToolCallMode): ToolRunCostEstimate {
  if (mode === "preview") return { costUsd: 0, workMinutes: 0 };
  return TOOL_COST_TABLE[toolName] ?? { costUsd: 0, workMinutes: 0 };
}

/** Convert an actual USD cost (e.g. worker-reported) into work minutes. */
export function workMinutesForCost(costUsd: number): number {
  return estimateWorkMinutesFromCost(costUsd);
}
