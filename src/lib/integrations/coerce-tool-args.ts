import type { ToolCallMode } from "@/lib/integrations/types";

const RESERVED_CALL_KEYS = new Set([
  "tool",
  "mode",
  "args",
  "employeeId",
  "employee_id",
  "requestedByUserId",
  "requested_by_user_id",
  "approvalId",
  "approval_id",
  "idempotencyKey",
  "idempotency_key",
]);

const ARG_ALIASES: Record<string, string> = {
  first_name: "firstName",
  last_name: "lastName",
  full_name: "fullName",
  company: "companyName",
  company_name: "companyName",
  organization: "companyName",
  organisation: "companyName",
  organization_name: "companyName",
  organisation_name: "companyName",
  contact: "contactName",
  contact_name: "contactName",
  contact_id: "contactId",
  deal: "dealName",
  deal_name: "dealName",
  deal_id: "dealId",
  expected_close_date: "expectedCloseDate",
  due_date: "dueDate",
  sheet: "sheetName",
  sheet_name: "sheetName",
  recipient: "recipientName",
  recipient_name: "recipientName",
  recipient_email: "recipientEmail",
  recipient_organization: "recipientOrganization",
  recipient_organisation: "recipientOrganization",
  campaign: "campaignName",
  campaign_name: "campaignName",
  campaign_id: "campaignId",
  scheduled_at: "scheduledAt",
  start_date: "startDate",
  end_date: "endDate",
  stage_focus: "stageFocus",
  firm_name: "firmName",
  firm_id: "firmId",
  linkedin_url: "linkedinUrl",
  fit_score: "fitScore",
  target_amount: "targetAmount",
  next_follow_up_at: "nextFollowUpAt",
  source_artifact_id: "sourceArtifactId",
  source_export_id: "sourceExportId",
  source_file_id: "sourceFileId",
  target_format: "targetFormat",
  append_rows: "appendRows",
};

export type CoercedToolCall = {
  tool: string;
  mode: ToolCallMode;
  args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => hasValue(value)));
}

function normalizeKey(key: string): string {
  return ARG_ALIASES[key] ?? ARG_ALIASES[key.toLowerCase()] ?? key;
}

function applyAliases(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const normalized = normalizeKey(key);
    if (out[normalized] === undefined || !hasValue(out[normalized])) {
      out[normalized] = value;
    }
  }
  return out;
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!["[", "{"].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function splitList(value: unknown): unknown {
  const parsed = parseJsonish(value);
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "string") return parsed;
  if (!parsed.includes(",")) return parsed;
  return parsed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseMoney(value: unknown): { amount?: number; currency?: string } {
  if (typeof value === "number" && Number.isFinite(value)) return { amount: value };
  if (typeof value !== "string") return {};

  const trimmed = value.trim();
  if (!trimmed) return {};
  const currency =
    /£/.test(trimmed) || /\bGBP\b/i.test(trimmed)
      ? "GBP"
      : /\$/.test(trimmed) || /\bUSD\b/i.test(trimmed)
        ? "USD"
        : /€/.test(trimmed) || /\bEUR\b/i.test(trimmed)
          ? "EUR"
          : undefined;
  const numberMatch = trimmed.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!numberMatch) return { currency };
  const multiplier = /\d\s*k\b/i.test(trimmed)
    ? 1_000
    : /\d\s*m\b/i.test(trimmed)
      ? 1_000_000
      : 1;
  const amount = Number(numberMatch[0].replace(/,/g, "")) * multiplier;
  return Number.isFinite(amount) ? { amount, currency } : { currency };
}

function parseNumber(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return value;
  const money = parseMoney(value);
  return money.amount ?? value;
}

function titleCaseStage(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function splitName(fullName: string): { firstName: string; lastName?: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? fullName.trim(),
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
  };
}

function normalizeRowsAndColumns(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  const parsedColumns = splitList(out.columns);
  const parsedRows = parseJsonish(out.rows);
  const rowsValue = Array.isArray(parsedRows) ? parsedRows : parsedRows ? [parsedRows] : out.rows;

  if (Array.isArray(parsedColumns)) {
    out.columns = parsedColumns.map((column) => String(column).trim()).filter(Boolean);
  }

  if (Array.isArray(rowsValue)) {
    if (rowsValue.every(isRecord)) {
      const records = rowsValue as Record<string, unknown>[];
      const columns =
        Array.isArray(out.columns) && out.columns.length
          ? out.columns.map(String)
          : [...new Set(records.flatMap((row) => Object.keys(row)))];
      out.columns = columns;
      out.rows = records.map((row) => columns.map((column) => row[column] ?? ""));
    } else {
      out.rows = rowsValue.map((row) => (Array.isArray(row) ? row : [row]));
    }
  }

  return out;
}

function normalizeSections(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  const parsed = parseJsonish(out.sections);
  if (Array.isArray(parsed)) {
    out.sections = parsed
      .map((section) => {
        if (isRecord(section)) {
          return {
            heading: String(section.heading ?? section.title ?? "Section"),
            body: String(section.body ?? section.content ?? section.text ?? ""),
          };
        }
        return { heading: "Notes", body: String(section ?? "") };
      })
      .filter((section) => section.body.trim());
  } else if (typeof parsed === "string" && parsed.trim()) {
    out.sections = [{ heading: "Notes", body: parsed.trim() }];
  }
  return out;
}

function normalizeSlides(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  const parsed = parseJsonish(out.slides);
  if (Array.isArray(parsed)) {
    out.slides = parsed
      .map((slide) => {
        if (isRecord(slide)) {
          const bullets = splitList(slide.bullets);
          return {
            title: String(slide.title ?? slide.heading ?? "Slide"),
            bullets: Array.isArray(bullets)
              ? bullets.map((bullet) => String(bullet)).filter(Boolean)
              : typeof slide.body === "string"
                ? [slide.body]
                : [],
            notes: slide.notes ? String(slide.notes) : undefined,
          };
        }
        return { title: "Slide", bullets: [String(slide ?? "")] };
      })
      .filter((slide) => slide.title.trim());
  } else if (typeof parsed === "string" && parsed.trim()) {
    out.slides = [{ title: out.title ? String(out.title) : "Overview", bullets: [parsed.trim()] }];
  }
  return out;
}

function liftRootArgs(raw: Record<string, unknown>): Record<string, unknown> {
  const rootArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED_CALL_KEYS.has(key)) continue;
    rootArgs[key] = value;
  }
  return rootArgs;
}

export function coerceToolArgs(
  tool: string,
  rawArgs: unknown,
  rootFallback?: Record<string, unknown>,
): Record<string, unknown> {
  const base = isRecord(rawArgs) ? rawArgs : {};
  const merged = { ...(rootFallback ?? {}), ...base };
  let args = compactRecord(applyAliases(merged));

  if (typeof args.amount === "string") {
    const parsed = parseMoney(args.amount);
    if (parsed.amount !== undefined) args.amount = parsed.amount;
    if (!args.currency && parsed.currency) args.currency = parsed.currency;
  }
  for (const numericKey of ["amount", "score", "fitScore", "targetAmount", "limit"]) {
    if (numericKey in args) args[numericKey] = parseNumber(args[numericKey]);
  }
  if (typeof args.value === "string" && !args.amount) {
    const parsed = parseMoney(args.value);
    if (parsed.amount !== undefined) args.amount = parsed.amount;
    if (!args.currency && parsed.currency) args.currency = parsed.currency;
  }

  if (typeof args.currency === "string") args.currency = args.currency.trim().toUpperCase();
  if ("stage" in args) args.stage = titleCaseStage(args.stage);
  if ("priority" in args && typeof args.priority === "string") args.priority = args.priority.toLowerCase();
  if ("platform" in args && typeof args.platform === "string") args.platform = args.platform.toLowerCase();

  if (tool === "crm.createCompany" && !args.name && args.companyName) {
    args.name = args.companyName;
  }

  if (tool === "crm.createContact") {
    const fullName = String(args.fullName ?? args.name ?? "").trim();
    if (fullName && !args.firstName) {
      args = { ...args, ...splitName(fullName) };
    }
  }

  if (tool === "crm.createDeal") {
    if (!args.name) {
      const company = args.companyName ? String(args.companyName) : undefined;
      args.name = company ? `${company} — opportunity` : args.contactName ? `${String(args.contactName)} — opportunity` : undefined;
    }
  }

  if (tool === "email.createDraft") {
    if (!args.recipientOrganization && args.companyName) args.recipientOrganization = args.companyName;
    if (!args.recipientName && args.contactName) args.recipientName = args.contactName;
  }

  if (
    tool === "artifact.createSpreadsheet" ||
    tool === "artifact.updateSpreadsheet" ||
    tool === "artifact.createSpreadsheetUpdate"
  ) {
    args = normalizeRowsAndColumns(args);
  }

  if (tool === "artifact.createPdfReport" || tool === "artifact.createDocx" || tool === "artifact.convertFile") {
    args = normalizeSections(args);
  }

  if (tool === "artifact.createPresentation") {
    args = normalizeSlides(args);
  }

  return compactRecord(args);
}

export function coerceToolCall(toolName: string, rawCall: unknown): CoercedToolCall {
  const raw = isRecord(rawCall) ? rawCall : {};
  const tool = String(raw.tool ?? toolName).trim();
  const mode = raw.mode === "preview" ? "preview" : "execute";
  const args = isRecord(raw.args) ? raw.args : {};
  const coercedArgs = coerceToolArgs(tool, args, liftRootArgs(raw));
  return { tool, mode, args: coercedArgs };
}
