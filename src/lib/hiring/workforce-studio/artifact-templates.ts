// Pure, dependency-free markdown builders for the Workforce Blueprint's
// generated artifacts (Team Charter, Role Scorecards). Shared by:
//  - plan-executor.ts (server) — writes the real `artifacts` rows at
//    provisioning time (generated -> reviewed/approved/superseded lifecycle
//    lives on the artifact itself, same as every other AdeHQ artifact).
//  - the client-side blueprint editor — renders a lightweight pre-approval
//    preview of exactly what will be generated, using the live draft.
//
// No imports from server-only modules here — this file must be safe to pull
// into a "use client" bundle.

import type { WorkforceBlueprintPayload, WorkforceSeat } from "./types";

export function buildTeamCharterMarkdown(name: string, payload: WorkforceBlueprintPayload): string {
  const lines: string[] = [`# ${name} — Team Charter`, ""];
  lines.push("## Seats", "");
  for (const seat of payload.seats) {
    lines.push(`- **${seat.roleTitle}** — ${seat.mission}`);
  }
  lines.push("", "## Rooms", "");
  for (const room of payload.rooms) {
    lines.push(`- **${room.name}** (${room.kind}) — ${room.description}`);
  }
  if (payload.outcomes.length) {
    lines.push("", "## Outcomes", "");
    for (const outcome of payload.outcomes) {
      lines.push(`- **${outcome.title}** — ${outcome.metric}. Target: ${outcome.target} (${outcome.checkpointCadence}).`);
    }
  }
  if (payload.edges.length) {
    lines.push("", "## Collaboration contracts", "");
    for (const edge of payload.edges) {
      const from = payload.seats.find((s) => s.id === edge.fromSeatId)?.roleTitle ?? edge.fromSeatId;
      const to = payload.seats.find((s) => s.id === edge.toSeatId)?.roleTitle ?? edge.toSeatId;
      lines.push(`- **${from} → ${to}** (${edge.type}): ${edge.contract.description}`);
    }
  }
  return lines.join("\n");
}

export function buildRoleScorecardMarkdown(seat: WorkforceSeat): string {
  const lines: string[] = [
    `# ${seat.roleTitle} — Role Scorecard`,
    "",
    `**Mission:** ${seat.mission}`,
    "",
    "## Responsibilities",
    "",
    ...seat.responsibilities.map((r) => `- ${r}`),
    "",
    "## Success metrics",
    "",
    ...seat.successMetrics.map((m) => `- ${m}`),
    "",
    "## Authority",
    "",
    ...Object.entries(seat.authorityPolicy).map(([domain, level]) => `- ${domain}: ${level}`),
  ];
  return lines.join("\n");
}
