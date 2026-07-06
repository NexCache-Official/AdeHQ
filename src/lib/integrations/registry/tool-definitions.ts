// ===========================================================================
// Tool registry — Phase 1 internal tools (Sales vertical slice).
// Every tool supports the preview/execute contract; definitions carry the
// arg schema, risk, approval policy, and human-readable preview builder.
// ===========================================================================

import { z } from "zod";
import type { ToolDefinition, ToolPreview } from "@/lib/integrations/types";

// ---------------------------------------------------------------------------
// Arg schemas
// ---------------------------------------------------------------------------

export const CreateContactArgsSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
  companyName: z.string().optional(),
  notes: z.string().optional(),
  source: z.string().optional(),
});
export type CreateContactArgs = z.infer<typeof CreateContactArgsSchema>;

export const CreateCompanyArgsSchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  industry: z.string().optional(),
  notes: z.string().optional(),
});
export type CreateCompanyArgs = z.infer<typeof CreateCompanyArgsSchema>;

export const CreateDealArgsSchema = z.object({
  name: z.string().min(1),
  amount: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  stage: z.string().optional(),
  contactName: z.string().optional(),
  contactId: z.string().optional(),
  companyName: z.string().optional(),
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
});
export type CreateDealArgs = z.infer<typeof CreateDealArgsSchema>;

export const UpdateDealStageArgsSchema = z.object({
  dealId: z.string().optional(),
  dealName: z.string().optional(),
  stage: z.string().min(1),
});
export type UpdateDealStageArgs = z.infer<typeof UpdateDealStageArgsSchema>;

export const ListContactsArgsSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
});
export type ListContactsArgs = z.infer<typeof ListContactsArgsSchema>;

export const ListDealsArgsSchema = z.object({
  stage: z.string().optional(),
  status: z.enum(["open", "won", "lost"]).optional(),
  limit: z.number().int().positive().max(50).optional(),
});
export type ListDealsArgs = z.infer<typeof ListDealsArgsSchema>;

export const CreateEmailDraftArgsSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  recipientName: z.string().optional(),
  recipientEmail: z.string().optional(),
  recipientOrganization: z.string().optional(),
});
export type CreateEmailDraftArgs = z.infer<typeof CreateEmailDraftArgsSchema>;

export const CreateTaskArgsSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  dueDate: z.string().optional(),
  assigneeType: z.enum(["human", "ai"]).optional(),
  assigneeId: z.string().optional(),
  /** Optional CRM links so follow-ups attach to the record. */
  contactId: z.string().optional(),
  dealId: z.string().optional(),
});
export type CreateTaskArgs = z.infer<typeof CreateTaskArgsSchema>;

export const SpreadsheetRowSchema = z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]));

export const CreateSpreadsheetArgsSchema = z.object({
  title: z.string().min(1),
  sheetName: z.string().optional(),
  columns: z.array(z.string().min(1)).min(1).max(40),
  rows: z.array(SpreadsheetRowSchema).max(500),
});
export type CreateSpreadsheetArgs = z.infer<typeof CreateSpreadsheetArgsSchema>;

export const ReportSectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
});

export const CreatePdfReportArgsSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  sections: z.array(ReportSectionSchema).min(1).max(20),
});
export type CreatePdfReportArgs = z.infer<typeof CreatePdfReportArgsSchema>;

// ---------------------------------------------------------------------------
// Preview helpers
// ---------------------------------------------------------------------------

function formatAmount(amount?: number, currency?: string): string {
  if (amount == null) return "Not specified";
  const code = (currency ?? "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toLocaleString()}`;
  }
}

function fields(entries: Array<[string, string | undefined | null]>): ToolPreview["fields"] {
  return entries
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const createContact: ToolDefinition<CreateContactArgs> = {
  name: "crm.createContact",
  domain: "crm",
  provider: "internal",
  description: "Create a contact in AdeHQ CRM.",
  readOnly: false,
  risk: "low",
  approval: "none",
  argsSchema: CreateContactArgsSchema,
  promptUsage:
    'crm.createContact — args: { "firstName": "Jane", "lastName"?, "email"?, "phone"?, "title"?, "companyName"?, "notes"?, "source"? }',
  buildPreview: (args) => ({
    title: `Create contact — ${[args.firstName, args.lastName].filter(Boolean).join(" ")}`,
    summary: `Add ${[args.firstName, args.lastName].filter(Boolean).join(" ")}${
      args.companyName ? ` (${args.companyName})` : ""
    } to the CRM.`,
    fields: fields([
      ["Name", [args.firstName, args.lastName].filter(Boolean).join(" ")],
      ["Email", args.email],
      ["Phone", args.phone],
      ["Title", args.title],
      ["Company", args.companyName],
      ["Source", args.source],
    ]),
    risk: "low",
  }),
};

const createCompany: ToolDefinition<CreateCompanyArgs> = {
  name: "crm.createCompany",
  domain: "crm",
  provider: "internal",
  description: "Create a company in AdeHQ CRM.",
  readOnly: false,
  risk: "low",
  approval: "none",
  argsSchema: CreateCompanyArgsSchema,
  promptUsage: 'crm.createCompany — args: { "name": "Acme Ltd", "domain"?, "industry"?, "notes"? }',
  buildPreview: (args) => ({
    title: `Create company — ${args.name}`,
    summary: `Add ${args.name} to the CRM.`,
    fields: fields([
      ["Name", args.name],
      ["Domain", args.domain],
      ["Industry", args.industry],
    ]),
    risk: "low",
  }),
};

const createDeal: ToolDefinition<CreateDealArgs> = {
  name: "crm.createDeal",
  domain: "crm",
  provider: "internal",
  description: "Create a deal in the AdeHQ CRM pipeline.",
  readOnly: false,
  risk: "low",
  approval: "none",
  argsSchema: CreateDealArgsSchema,
  promptUsage:
    'crm.createDeal — args: { "name": "Acme Ltd — annual plan", "amount"?: 5000, "currency"?: "USD", "stage"?: "Qualified", "contactName"?, "companyName"?, "expectedCloseDate"?: "2026-08-01", "notes"? }',
  buildPreview: (args) => ({
    title: `Create deal — ${args.name}`,
    summary: `${args.name}: ${formatAmount(args.amount, args.currency)} · ${args.stage ?? "Lead"}`,
    fields: fields([
      ["Deal", args.name],
      ["Amount", formatAmount(args.amount, args.currency)],
      ["Stage", args.stage ?? "Lead"],
      ["Contact", args.contactName],
      ["Company", args.companyName],
      ["Expected close", args.expectedCloseDate],
    ]),
    risk: "medium",
  }),
};

const updateDealStage: ToolDefinition<UpdateDealStageArgs> = {
  name: "crm.updateDealStage",
  domain: "crm",
  provider: "internal",
  description: "Move a deal to another pipeline stage.",
  readOnly: false,
  risk: "low",
  approval: "none",
  argsSchema: UpdateDealStageArgsSchema,
  promptUsage:
    'crm.updateDealStage — args: { "dealId" or "dealName", "stage": "Negotiation" } (stages: Lead, Qualified, Proposal, Negotiation, Won, Lost)',
  buildPreview: (args) => ({
    title: `Move deal to ${args.stage}`,
    summary: `Move ${args.dealName ?? args.dealId ?? "deal"} to stage "${args.stage}".`,
    fields: fields([
      ["Deal", args.dealName ?? args.dealId],
      ["New stage", args.stage],
    ]),
    risk: "low",
  }),
};

const listContacts: ToolDefinition<ListContactsArgs> = {
  name: "crm.listContacts",
  domain: "crm",
  provider: "internal",
  description: "List or search CRM contacts.",
  readOnly: true,
  risk: "low",
  approval: "none",
  argsSchema: ListContactsArgsSchema,
  promptUsage: 'crm.listContacts — args: { "query"?: "acme", "limit"?: 10 }',
  buildPreview: (args) => ({
    title: "List contacts",
    summary: args.query ? `Search contacts matching "${args.query}".` : "List recent contacts.",
    fields: fields([["Query", args.query]]),
    risk: "low",
  }),
};

const listDeals: ToolDefinition<ListDealsArgs> = {
  name: "crm.listDeals",
  domain: "crm",
  provider: "internal",
  description: "List CRM deals, optionally by stage or status.",
  readOnly: true,
  risk: "low",
  approval: "none",
  argsSchema: ListDealsArgsSchema,
  promptUsage: 'crm.listDeals — args: { "stage"?: "Qualified", "status"?: "open", "limit"?: 10 }',
  buildPreview: (args) => ({
    title: "List deals",
    summary: "List deals in the pipeline.",
    fields: fields([
      ["Stage", args.stage],
      ["Status", args.status],
    ]),
    risk: "low",
  }),
};

const createEmailDraft: ToolDefinition<CreateEmailDraftArgs> = {
  name: "email.createDraft",
  domain: "email",
  provider: "internal",
  description: "Create a reviewable email draft artifact (never sends).",
  readOnly: false,
  risk: "low",
  approval: "none",
  argsSchema: CreateEmailDraftArgsSchema,
  promptUsage:
    'email.createDraft — args: { "subject": "...", "body": "...", "recipientName"?, "recipientEmail"?, "recipientOrganization"? }',
  buildPreview: (args) => ({
    title: `Email draft — ${args.subject}`,
    summary: `Draft email${args.recipientName ? ` to ${args.recipientName}` : ""}: "${args.subject}".`,
    fields: fields([
      ["To", args.recipientName],
      ["Organization", args.recipientOrganization],
      ["Subject", args.subject],
    ]),
    risk: "low",
  }),
};

const createTask: ToolDefinition<CreateTaskArgs> = {
  name: "tasks.createTask",
  domain: "tasks",
  provider: "internal",
  description: "Create a follow-up task in AdeHQ Tasks.",
  readOnly: false,
  risk: "low",
  approval: "none",
  argsSchema: CreateTaskArgsSchema,
  promptUsage:
    'tasks.createTask — args: { "title": "Follow up with Jane by Friday", "description"?, "priority"?: "medium", "dueDate"?: "2026-07-10", "assigneeType"?: "ai" }',
  buildPreview: (args) => ({
    title: `Create task — ${args.title}`,
    summary: args.title,
    fields: fields([
      ["Task", args.title],
      ["Priority", args.priority ?? "medium"],
      ["Due", args.dueDate],
    ]),
    risk: "low",
  }),
};

const createSpreadsheet: ToolDefinition<CreateSpreadsheetArgs> = {
  name: "artifact.createSpreadsheet",
  domain: "artifact",
  provider: "internal",
  description: "Generate an Excel spreadsheet from tabular data and save it to Drive.",
  readOnly: false,
  risk: "low",
  approval: "none",
  asyncJobType: "artifact_xlsx",
  argsSchema: CreateSpreadsheetArgsSchema,
  promptUsage:
    'artifact.createSpreadsheet — args: { "title": "Q3 pipeline export", "columns": ["Company", "Stage", "Amount"], "rows": [["Acme", "Qualified", 5000]], "sheetName"?: "Pipeline" }',
  buildPreview: (args) => ({
    title: `Spreadsheet — ${args.title}`,
    summary: `${args.title}: ${args.rows.length} rows × ${args.columns.length} columns.`,
    fields: fields([
      ["Title", args.title],
      ["Columns", args.columns.join(", ")],
      ["Rows", String(args.rows.length)],
    ]),
    risk: "low",
  }),
};

const createPdfReport: ToolDefinition<CreatePdfReportArgs> = {
  name: "artifact.createPdfReport",
  domain: "artifact",
  provider: "internal",
  description: "Generate a formatted PDF report with sections and save it to Drive.",
  readOnly: false,
  risk: "low",
  approval: "none",
  asyncJobType: "artifact_pdf",
  argsSchema: CreatePdfReportArgsSchema,
  promptUsage:
    'artifact.createPdfReport — args: { "title": "Sales weekly summary", "summary"?: "One-line overview", "sections": [{ "heading": "Highlights", "body": "..." }] }',
  buildPreview: (args) => ({
    title: `Report — ${args.title}`,
    summary: args.summary ?? `${args.title} with ${args.sections.length} sections.`,
    fields: fields([
      ["Title", args.title],
      ["Sections", String(args.sections.length)],
      ["Summary", args.summary],
    ]),
    risk: "low",
  }),
};

// ---------------------------------------------------------------------------
// Registry access
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  createContact,
  createCompany,
  createDeal,
  updateDealStage,
  listContacts,
  listDeals,
  createEmailDraft,
  createTask,
  createSpreadsheet,
  createPdfReport,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
] as ToolDefinition<any>[];

const TOOL_REGISTRY = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getToolDefinition(name: string): ToolDefinition<any> | null {
  return TOOL_REGISTRY.get(name.trim()) ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listToolDefinitions(): ToolDefinition<any>[] {
  return TOOL_DEFINITIONS;
}
