// Client-side fetch wrappers for the Workforce Studio API. Mirrors the
// auth/header conventions in src/lib/hiring/hiring-api.ts.

import { authHeaders } from "@/lib/api/auth-client";
import type { CompanyOperatingProfile } from "./company-profile-types";
import type { WorkforceBlueprintPayload, WorkforceBlueprintRecord, SimulationReport } from "./types";
import type { TeamHirePlanRecord, TeamHirePlanStep } from "./types";
import type { NlEditDiffOp, NlEditProposal } from "./nl-edit-apply";

export type TemplateSummary = {
  key: string;
  version: string;
  name: string;
  description: string;
  industry: string;
  intakeQuestions: import("./templates/types").IntakeQuestion[];
  baseSeatCount: number;
  scalingRuleCount: number;
};

async function req<T>(path: string, init: RequestInit, workspaceId: string): Promise<T> {
  const headers = await authHeaders(workspaceId);
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body.error ?? "Workforce Studio request failed.") as Error & {
      code?: string;
      status?: number;
      lockedByUserId?: string | null;
      currentRevision?: number;
    };
    error.code = body.code;
    error.status = res.status;
    error.lockedByUserId = body.lockedByUserId;
    error.currentRevision = body.currentRevision;
    throw error;
  }
  return body as T;
}

export async function fetchTemplates(workspaceId: string): Promise<TemplateSummary[]> {
  const data = await req<{ templates: TemplateSummary[] }>(
    `/api/hiring/workforce-studio/templates?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "GET" },
    workspaceId,
  );
  return data.templates;
}

export async function fetchCompanyProfile(workspaceId: string): Promise<CompanyOperatingProfile> {
  const data = await req<{ profile: CompanyOperatingProfile }>(
    `/api/hiring/workforce-studio/profile?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "GET" },
    workspaceId,
  );
  return data.profile;
}

export async function saveCompanyProfile(
  workspaceId: string,
  profile: Partial<CompanyOperatingProfile>,
): Promise<CompanyOperatingProfile> {
  const data = await req<{ profile: CompanyOperatingProfile }>(
    "/api/hiring/workforce-studio/profile",
    { method: "PUT", body: JSON.stringify({ workspaceId, ...profile }) },
    workspaceId,
  );
  return data.profile;
}

export async function fetchBlueprints(workspaceId: string): Promise<WorkforceBlueprintRecord[]> {
  const data = await req<{ blueprints: WorkforceBlueprintRecord[] }>(
    `/api/hiring/workforce-studio/blueprints?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "GET" },
    workspaceId,
  );
  return data.blueprints;
}

export async function createBlueprint(
  workspaceId: string,
  params: { templateKey: string; name?: string; intakeAnswers: Record<string, unknown> },
): Promise<WorkforceBlueprintRecord> {
  const data = await req<{ blueprint: WorkforceBlueprintRecord }>(
    "/api/hiring/workforce-studio/blueprints",
    { method: "POST", body: JSON.stringify({ workspaceId, ...params }) },
    workspaceId,
  );
  return data.blueprint;
}

export async function fetchBlueprint(workspaceId: string, blueprintId: string): Promise<WorkforceBlueprintRecord> {
  const data = await req<{ blueprint: WorkforceBlueprintRecord }>(
    `/api/hiring/workforce-studio/blueprints/${blueprintId}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "GET" },
    workspaceId,
  );
  return data.blueprint;
}

export async function acquireLock(
  workspaceId: string,
  blueprintId: string,
): Promise<{ lockToken: string; lockExpiresAt: string }> {
  return req(
    `/api/hiring/workforce-studio/blueprints/${blueprintId}/lock`,
    { method: "POST", body: JSON.stringify({ workspaceId }) },
    workspaceId,
  );
}

export async function releaseLock(workspaceId: string, blueprintId: string, lockToken: string): Promise<void> {
  await req(
    `/api/hiring/workforce-studio/blueprints/${blueprintId}/lock`,
    { method: "DELETE", body: JSON.stringify({ workspaceId, lockToken }) },
    workspaceId,
  );
}

export async function patchBlueprintDraft(
  workspaceId: string,
  blueprintId: string,
  params: {
    lockToken: string;
    expectedRevision: number;
    payload: WorkforceBlueprintPayload;
    changeSummary?: string;
    name?: string;
  },
): Promise<WorkforceBlueprintRecord> {
  const data = await req<{ blueprint: WorkforceBlueprintRecord }>(
    `/api/hiring/workforce-studio/blueprints/${blueprintId}`,
    { method: "PATCH", body: JSON.stringify({ workspaceId, ...params }) },
    workspaceId,
  );
  return data.blueprint;
}

export async function approveBlueprintDraft(
  workspaceId: string,
  blueprintId: string,
  params: { lockToken: string; expectedRevision: number },
): Promise<WorkforceBlueprintRecord> {
  const data = await req<{ blueprint: WorkforceBlueprintRecord }>(
    `/api/hiring/workforce-studio/blueprints/${blueprintId}/approve`,
    { method: "POST", body: JSON.stringify({ workspaceId, ...params }) },
    workspaceId,
  );
  return data.blueprint;
}

export async function runSimulation(
  workspaceId: string,
  blueprintId: string,
  params: { expectedRevision: number },
): Promise<SimulationReport> {
  const data = await req<{ report: SimulationReport }>(
    `/api/hiring/workforce-studio/blueprints/${blueprintId}/simulate`,
    { method: "POST", body: JSON.stringify({ workspaceId, ...params }) },
    workspaceId,
  );
  return data.report;
}

export async function startProvisioning(
  workspaceId: string,
  blueprintId: string,
): Promise<TeamHirePlanRecord> {
  const data = await req<{ plan: TeamHirePlanRecord }>(
    `/api/hiring/workforce-studio/blueprints/${blueprintId}/provision`,
    { method: "POST", body: JSON.stringify({ workspaceId }) },
    workspaceId,
  );
  return data.plan;
}

export async function fetchPlan(
  workspaceId: string,
  planId: string,
): Promise<{ plan: TeamHirePlanRecord; steps: TeamHirePlanStep[] }> {
  return req(
    `/api/hiring/workforce-studio/plans/${planId}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "GET" },
    workspaceId,
  );
}

export async function proposeNlBlueprintEdit(
  workspaceId: string,
  blueprintId: string,
  instruction: string,
): Promise<{ proposal: NlEditProposal | null; ops: NlEditDiffOp[]; message?: string }> {
  return req(
    `/api/hiring/workforce-studio/blueprints/${blueprintId}/nl-edit`,
    { method: "POST", body: JSON.stringify({ workspaceId, instruction }) },
    workspaceId,
  );
}

export async function advanceProvisioning(
  workspaceId: string,
  planId: string,
): Promise<{ plan: TeamHirePlanRecord; steps: TeamHirePlanStep[] }> {
  return req(
    `/api/hiring/workforce-studio/plans/${planId}/advance`,
    { method: "POST", body: JSON.stringify({ workspaceId }) },
    workspaceId,
  );
}
