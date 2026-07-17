import type { MultiAgentPolicy } from "./types";

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return fallback;
}

/**
 * Platform defaults for PR-19 V1.
 * ADEHQ_MULTI_AGENT_MAX_EMPLOYEES=3
 * ADEHQ_MULTI_AGENT_MAX_STEPS=8
 * ADEHQ_MULTI_AGENT_AUTO_WH_LIMIT=5
 * ADEHQ_MULTI_AGENT_REVIEW_ENABLED=1
 */
export function getMultiAgentPolicy(): MultiAgentPolicy {
  return {
    maxEmployees: Math.min(envInt("ADEHQ_MULTI_AGENT_MAX_EMPLOYEES", 3), 5),
    maxSteps: Math.min(envInt("ADEHQ_MULTI_AGENT_MAX_STEPS", 8), 8),
    autoWhLimit: envInt("ADEHQ_MULTI_AGENT_AUTO_WH_LIMIT", 5),
    reviewEnabled: envBool("ADEHQ_MULTI_AGENT_REVIEW_ENABLED", true),
  };
}
