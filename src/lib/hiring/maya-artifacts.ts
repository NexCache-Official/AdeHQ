import type { AIEmployee, SavedArtifact } from "@/lib/types";
import { authHeaders } from "@/lib/api/auth-client";

export type MayaArtifactKind =
  | "workforce_review"
  | "improvement_plan"
  | "adehq_guide"
  | "room_setup";

export function buildWorkforceReviewMarkdown(
  employees: AIEmployee[],
  firstName = "there",
): string {
  const roster = employees.filter((e) => e.id !== "emp-maya" && !e.name.toLowerCase().includes("maya"));
  if (roster.length === 0) {
    return `# Workforce Review\n\nNo AI employees yet — ${firstName}, start with one hire tied to your most urgent job.`;
  }
  const lines = roster.map((e) => `- **${e.name}** — ${e.role}`);
  const roles = new Set(roster.map((e) => e.role.toLowerCase()));
  const gaps: string[] = [];
  if (![...roles].some((r) => /research|analyst/i.test(r))) gaps.push("Market research / competitive intel");
  if (![...roles].some((r) => /sales|sdr/i.test(r))) gaps.push("Sales outreach / pipeline");
  if (![...roles].some((r) => /engineer|developer/i.test(r))) gaps.push("Engineering / product build");

  return `# Workforce Review

## Current team (${roster.length})
${lines.join("\n")}

## Role coverage
${gaps.length ? `Consider adding: ${gaps.join(", ")}.` : "Solid coverage for a small team."}

## Recommended next actions
1. Review approval rules on high-autonomy roles
2. Ensure each employee has a clear primary room
3. ${gaps.length ? `Hire for: ${gaps[0]}` : "Deepen briefs and tools for your strongest hire"}`;
}

export function buildAdehqGuideMarkdown(firstName = "there"): string {
  return `# AdeHQ — How it works

Hi ${firstName} — here's a quick map of the workspace.

## Core concepts
- **Rooms** — shared spaces for projects and teams
- **Topics** — focused threads inside rooms and DMs
- **Direct messages** — 1:1 with any AI employee (including Maya)
- **Workforce** — your AI employee roster, tools, memory, and approvals

## Typical flow
1. Create or open a room for a project
2. Add topics for workstreams (research, hiring, ops)
3. @mention employees for help; review outputs as artifacts
4. Save durable context to **Memory** from summaries or suggestions

## Maya can help with
- Reviewing your workforce and suggesting gaps
- Hiring new AI employees (chat-native hiring flow)
- Improving employee instructions, tools, and approval rules
- Organizing rooms and workspace structure

Ask me anytime — e.g. "Review my workforce" or "Help me hire a researcher."`;
}

export function buildImprovementPlanMarkdown(employee: AIEmployee): string {
  return `# Employee Improvement Plan: ${employee.name}

**Role:** ${employee.role}

## Focus areas
- Role & responsibilities — tighten scope and success criteria
- Personality & tone — align with your team voice
- Tools & integrations — enable the right connectors
- Approval rules — set guardrails for sensitive actions
- Memory & context — capture durable facts from recent work
- Output quality — refine response style and artifacts

## Next step
Tell Maya what to improve first, or open ${employee.name}'s profile to edit instructions directly.`;
}

export async function createMayaArtifactClient(params: {
  workspaceId: string;
  roomId: string;
  topicId: string;
  kind: MayaArtifactKind;
  title: string;
  contentMarkdown: string;
  messageId?: string;
}): Promise<SavedArtifact> {
  const artifactType =
    params.kind === "workforce_review"
      ? "report"
      : params.kind === "improvement_plan"
        ? "brief"
        : params.kind === "room_setup"
          ? "checklist"
          : "note";

  const headers = await authHeaders();
  const res = await fetch("/api/artifacts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      topicId: params.topicId,
      title: params.title,
      artifactType,
      contentMarkdown: params.contentMarkdown,
      sourceMessageIds: params.messageId ? [params.messageId] : [],
      status: "saved",
      contentJson: { mayaArtifactKind: params.kind },
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? "Could not create artifact.");
  window.dispatchEvent(
    new CustomEvent("adehq:topic-artifacts-changed", { detail: { topicId: params.topicId } }),
  );
  return payload.artifact as SavedArtifact;
}

export function messageArtifactFromSaved(
  artifact: SavedArtifact,
  kind: MayaArtifactKind,
  createdByName: string,
): import("@/lib/types").MessageArtifact {
  return {
    type: "artifact",
    id: artifact.id,
    label: artifact.title,
    meta: {
      artifactType: artifact.artifactType,
      artifactStatus: artifact.status === "saved" ? "saved" : "draft",
      createdByName,
      sourceCount: artifact.sourceMessageIds.length,
      mayaArtifactKind: kind,
    },
  };
}
