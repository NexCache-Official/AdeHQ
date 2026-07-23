// PR-22E — structural quality score for curated + legacy packs.
// Run: npm run test:workforce-studio:pack-score

import { composeBlueprintFromTemplate } from "../src/lib/hiring/workforce-studio/composer";
import { listTemplateManifests } from "../src/lib/hiring/workforce-studio/templates/registry";
import { forecastWorkHours } from "../src/lib/hiring/workforce-studio/simulation";
import { assertSafeRule } from "../src/lib/hiring/workforce-studio/json-logic";

let criticals = 0;
let warnings = 0;

function crit(msg: string) {
  criticals += 1;
  console.error(`CRITICAL ${msg}`);
}
function warn(msg: string) {
  warnings += 1;
  console.warn(`WARN ${msg}`);
}
function ok(msg: string) {
  console.log(`OK ${msg}`);
}

console.log("=== Workforce pack quality score ===\n");

for (const manifest of listTemplateManifests()) {
  const seatIds = new Set(manifest.baseSeats.map((s) => s.templateSeatId));
  const roomIds = new Set(manifest.baseRooms.map((r) => r.templateRoomId));

  if (manifest.baseSeats.length === 0) crit(`[${manifest.key}] no base seats`);
  for (const seat of manifest.baseSeats) {
    if (seat.primaryRoomTemplateId && !roomIds.has(seat.primaryRoomTemplateId)) {
      crit(`[${manifest.key}] seat ${seat.templateSeatId} missing room ${seat.primaryRoomTemplateId}`);
    }
    if (/\{\{\w+\}\}/.test(seat.missionTemplate)) {
      warn(`[${manifest.key}] seat ${seat.templateSeatId} still has placeholders`);
    }
  }
  for (const edge of manifest.baseEdges) {
    if (!seatIds.has(edge.fromSeatTemplateId) || !seatIds.has(edge.toSeatTemplateId)) {
      crit(`[${manifest.key}] edge references unknown seats`);
    }
  }
  for (const rule of manifest.scalingRules) {
    try {
      assertSafeRule(rule.condition);
    } catch {
      crit(`[${manifest.key}] unsafe scaling rule ${rule.id}`);
    }
  }

  const hasSupport = manifest.baseSeats.some((s) => /support|success/.test(s.roleKey));
  if (hasSupport) {
    const hasHandoff = manifest.baseEdges.some((e) => e.type === "escalation" || e.type === "handoff" || e.type === "collaborates_with");
    if (!hasHandoff && manifest.baseSeats.length > 1) {
      warn(`[${manifest.key}] support seat without collaboration edge`);
    }
  }

  try {
    const payload = composeBlueprintFromTemplate(manifest, { team_size_preference: "lean" }, null);
    const roomed = new Set(payload.rooms.flatMap((r) => r.memberSeatIds));
    const orphans = payload.seats.filter((s) => !roomed.has(s.id));
    if (orphans.length) crit(`[${manifest.key}] ${orphans.length} orphan seat(s) after compose`);
    const bands = forecastWorkHours(payload.seats);
    const low = bands.reduce((s, b) => s + b.lowWh, 0);
    const high = bands.reduce((s, b) => s + b.highWh, 0);
    if (high < low) crit(`[${manifest.key}] WH high < low`);
    if (high > 0 && high / Math.max(low, 0.1) > 4) warn(`[${manifest.key}] WH band unusually wide (${low}–${high})`);
    ok(`[${manifest.key}] ${payload.seats.length} seats, WH ${Math.round(low)}–${Math.round(high)}`);
  } catch (err) {
    crit(`[${manifest.key}] compose failed: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`\n=== Score: ${criticals} critical, ${warnings} warnings ===`);
process.exit(criticals === 0 ? 0 : 1);
