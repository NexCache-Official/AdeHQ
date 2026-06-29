import { z } from "zod";

export const WorkLogEffectSchema = z.object({
  action: z.string(),
  summary: z.string().optional(),
  toolUsed: z.string().optional(),
  status: z.enum(["success", "pending", "failed", "needs_approval"]).optional(),
  relatedEntityType: z.enum(["task", "memory", "approval", "message"]).optional(),
});

export const TaskEffectSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(["open", "in_progress", "waiting_approval", "blocked", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assigneeType: z.enum(["human", "ai"]).optional(),
  assigneeId: z.string().optional(),
  createdFrom: z.string().optional(),
});

export const MemoryEffectSchema = z.object({
  type: z
    .enum(["decision", "research", "architecture", "preference", "instruction", "general"])
    .optional(),
  title: z.string(),
  content: z.string(),
  status: z.enum(["draft", "approved", "pinned", "superseded"]).optional(),
});

export const ApprovalEffectSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  actionType: z.enum(["tool_access", "memory_pin", "task_creation", "external_action"]).optional(),
});

export const EmailDraftEffectSchema = z.object({
  subject: z.string(),
  body: z.string(),
  recipient: z.string().optional(),
  company: z.string().optional(),
});

export const EmployeeEffectsSchema = z.object({
  workLog: z.array(WorkLogEffectSchema).default([]),
  tasks: z.array(TaskEffectSchema).default([]),
  memory: z.array(MemoryEffectSchema).default([]),
  approvals: z.array(ApprovalEffectSchema).default([]),
  emailDrafts: z.array(EmailDraftEffectSchema).default([]),
  statusChange: z.enum(["idle", "working", "waiting_approval", "on_call", "blocked"]).optional(),
  handoffTo: z.array(z.string()).optional(),
  currentTask: z.string().optional(),
});

export const ModelResponseSchema = z.object({
  reply: z.string(),
  effects: EmployeeEffectsSchema,
});

export const EmployeeResponseSchema = z.object({
  employeeId: z.string(),
  employeeName: z.string(),
  reply: z.string(),
  effect: EmployeeEffectsSchema,
});
