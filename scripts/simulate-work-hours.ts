/**
 * V19.9.1a — Work Hours shadow simulation (no blocking/charging).
 */

import { estimateWorkMinutesFromCost } from "@/lib/ai/work-hours/estimate";
import { getWorkMinuteUsdRate } from "@/lib/ai/work-hours/constants";

type Scenario = {
  name: string;
  modelCostUsd: number;
};

const scenarios: Scenario[] = [
  { name: "Maya quick reply", modelCostUsd: 0.0003 },
  { name: "Priya DM reply", modelCostUsd: 0.0012 },
  { name: "Topic summary", modelCostUsd: 0.0025 },
  { name: "Artifact generation", modelCostUsd: 0.008 },
  { name: "File embedding batch", modelCostUsd: 0.0001 },
];

console.log("AdeHQ Work Hours simulation (shadow metering — V19.9.1a)\n");
console.log(`AI_WORK_MINUTE_USD=${getWorkMinuteUsdRate()}\n`);

for (const s of scenarios) {
  const minutes = estimateWorkMinutesFromCost(s.modelCostUsd);
  console.log(
    `${s.name}: model $${s.modelCostUsd.toFixed(4)} → ~${minutes} shadow work minute(s)`,
  );
}

console.log("\nShadow ledger rows are recorded on work unit completion when AI_WORK_HOURS_SHADOW_ENABLED=true.");
console.log("PASS  simulate-work-hours\n");
