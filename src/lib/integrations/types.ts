// ===========================================================================
// Integration Layer — Tool Execution Core types (Phase 1)
// ===========================================================================

import type { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIEmployee, MessageArtifact, WorkspaceMemberRole } from "@/lib/types";

/** Minimal employee shape needed by the Tool Execution Core. */
export type IntegrationEmployee = Pick<AIEmployee, "id" | "name" | "roleKey" | "tools">;

/** Capability domains routed by the Tool Execution Core. */
export type CapabilityDomain =
  | "crm"
  | "email"
  | "tasks"
  | "artifact"
  | "social"
  | "calendar"
  | "investor"
  | "team"
  | "drive";

export type ToolCallMode = "preview" | "execute";

export type ToolRiskLevel = "low" | "medium" | "high";

/**
 * Approval policy per tool:
 * - "none"      — execute runs immediately (reads, internal drafts).
 * - "suggested" — execute runs immediately; preview creates an approval card
 *                 (internal writes worth double-checking, e.g. deals).
 * - "required"  — execute is blocked until a matching approval is approved
 *                 (external writes, publishes, sends, bulk, deletes).
 */
export type ToolApprovalPolicy = "none" | "suggested" | "required";

export type ToolProviderKind = "internal" | "external";

/** Human-readable preview rendered on approval cards — never raw JSON. */
export type ToolPreview = {
  title: string;
  summary: string;
  fields: Array<{ label: string; value: string }>;
  risk: ToolRiskLevel;
};

export type ToolExecutionContext = {
  client: SupabaseClient;
  workspaceId: string;
  employeeId: string;
  /** Display name for work log / artifact labels. */
  employeeName?: string;
  requestedByUserId?: string;
  /** Workspace role of the triggering human, when known (API calls). */
  requestedByRole?: WorkspaceMemberRole;
  roomId?: string;
  topicId?: string;
  agentRunId?: string;
  triggerMessageId?: string;
  /** Original human text that caused the run, used only to repair weak model args. */
  triggerMessageText?: string;
  /** When the run was bridged from the workspace inbox (Slice D). */
  emailThreadId?: string;
  emailMessageId?: string;
  /** Mutable per-batch hydration state shared across sequential tool calls. */
  toolHydrationState?: Record<string, unknown>;
};

export type ToolExecutionOutput = {
  /** Business-language summary of what happened ("Created contact Jane Doe"). */
  summary: string;
  /** Structured result payload persisted to integration_tool_runs.output_payload. */
  payload: Record<string, unknown>;
  /** Id of the primary object created/affected, when applicable. */
  objectId?: string;
  /** External URL for the object (Phase 4 adapters). */
  externalUrl?: string;
  /** Work log action key (snake_case business action). */
  workLogAction?: string;
  /** Related entity for the work log entry. */
  relatedEntityType?:
    | "task"
    | "memory"
    | "approval"
    | "message"
    | "artifact"
    | "contact"
    | "deal"
    | "company"
    | "campaign"
    | "content_post"
    | "investor_firm"
    | "investor_contact"
    | "investor_pipeline";
  relatedEntityId?: string;
  /** Optional rich chat chip (e.g. email draft artifact card). */
  messageArtifact?: MessageArtifact;
};

export type ToolDefinition<Args = Record<string, unknown>> = {
  /** Fully qualified tool name, e.g. "crm.createDeal". */
  name: string;
  domain: CapabilityDomain;
  provider: ToolProviderKind;
  description: string;
  /** True for read-only tools — never need approval, skip work log noise. */
  readOnly: boolean;
  risk: ToolRiskLevel;
  approval: ToolApprovalPolicy;
  /** Zod schema validating tool args. */
  argsSchema: z.ZodType<Args>;
  /** Compact usage doc injected into employee prompts. */
  promptUsage: string;
  /** Build the human-readable preview for approval cards and preview runs. */
  buildPreview: (args: Args) => ToolPreview;
  /** If set, execute enqueues an integration_job of this type instead of running inline. */
  asyncJobType?: string;
};

export type ToolCallRequest = {
  tool: string;
  mode: ToolCallMode;
  args: Record<string, unknown>;
  employeeId: string;
  requestedByUserId?: string;
  /** Approved approval id — required to execute approval-gated tools. */
  approvalId?: string;
  /** Caller-supplied idempotency key; derived automatically when omitted. */
  idempotencyKey?: string;
};

export type ToolCallStatus =
  | "success"
  | "preview"
  | "approval_pending"
  | "blocked"
  | "failed"
  | "queued";

export type ToolCallResult = {
  status: ToolCallStatus;
  tool: string;
  mode: ToolCallMode;
  toolRunId?: string;
  /** Present when an approval card was created (preview / approval-required). */
  approvalId?: string;
  /** Present when execution was queued as an async job. */
  jobId?: string;
  preview?: ToolPreview;
  output?: ToolExecutionOutput;
  costUsd: number;
  workMinutes: number;
  error?: string;
  /** Chat chips describing the result (approval cards, work-log chips). */
  messageArtifacts: MessageArtifact[];
  /** Original args — used for retry UI on failed runs. */
  inputArgs?: Record<string, unknown>;
  idempotencyKey?: string;
  triggerMessageId?: string;
};

/** Model-emitted tool call (effects.toolCalls[]). */
export type ToolCallEffect = {
  tool: string;
  mode?: ToolCallMode;
  args: Record<string, unknown>;
};

export type IntegrationJobRecord = {
  id: string;
  workspaceId: string;
  employeeId?: string;
  jobType: string;
  toolRunId?: string;
  status: "queued" | "running" | "success" | "failed";
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  createdAt: string;
};

export type IntegrationToolRunRecord = {
  id: string;
  workspaceId: string;
  employeeId: string;
  requestedByUserId?: string;
  roomId?: string;
  topicId?: string;
  agentRunId?: string;
  triggerMessageId?: string;
  capabilityDomain: string;
  toolName: string;
  provider: string;
  connectionId?: string;
  approvalId?: string;
  jobId?: string;
  mode: ToolCallMode;
  idempotencyKey?: string;
  inputPayload: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;
  previewSnapshot?: Record<string, unknown>;
  status: "pending" | "running" | "success" | "failed" | "blocked";
  externalObjectId?: string;
  externalUrl?: string;
  costUsd: number;
  workMinutes: number;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
};
