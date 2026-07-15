import type { ToolCallResult } from "@/lib/integrations/types";
import { coerceToolArgs } from "@/lib/integrations/coerce-tool-args";
import {
  buildPdfSectionsFromMessage,
  buildPresentationSlidesFromMessage,
  buildSpreadsheetRowsFromMessage,
  detectSowOrRfp,
  detectVendorCompare,
  extractColumnList,
  extractRequestedCount,
  firstSentence as firstSentenceFromMessage,
} from "@/lib/integrations/artifact-content-from-message";

export type ToolHydrationState = {
  userMessage?: string;
  companyName?: string;
  contactName?: string;
  dealName?: string;
  amount?: number;
  currency?: string;
  stage?: string;
  campaignName?: string;
  firmName?: string;
  roleKey?: string;
  inboxDraftId?: string;
  emailSubject?: string;
  recipientEmail?: string;
  emailBodyPreview?: string;
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstSentence(text: string): string {
  return firstSentenceFromMessage(text);
}

function cleanEntityName(value: string): string {
  return value
    .replace(/\s+(?:and|with|for|to|then|please|pls)\b.*$/i, "")
    .replace(/[,.!?;:]+$/g, "")
    .trim();
}

function extractCompanyName(message: string): string | undefined {
  const patterns = [
    /\bcompany\s+(?:called|named)\s+([^,.!?;\n]+?)(?=\s+(?:and|with|for|to|then)\b|[,.!?;\n]|$)/i,
    /\b(?:for|with|at)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4})(?=\s+(?:and|with|for|to|then)\b|[,.!?;\n]|$)/,
    /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){1,4})\s+(?:in\s+)?(?:CRM|pipeline|deal|account)\b/,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const name = cleanEntityName(match[1]);
      if (name && !/\b(contact|deal|email|task|spreadsheet|summary)\b/i.test(name)) return name;
    }
  }
  return undefined;
}

function extractContactName(message: string): string | undefined {
  const patterns = [
    /\badd\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})(?:\s+as\s+(?:(?:a|the)\s+)?contact|\s+to\b|[,.!?;\n]|$)/,
    /\bcontact\s+(?:called|named)?\s*([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})(?=\s+(?:and|with|for|to|then)\b|[,.!?;\n]|$)/i,
    /\b(?:for|to)\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})\s+(?:at|from)\s+[A-Z]/,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return cleanEntityName(match[1]);
  }
  return undefined;
}

function extractCampaignName(message: string): string | undefined {
  const match = message.match(/\bcampaign\s+(?:called|named|for)?\s*([^,.!?;\n]+?)(?=\s+(?:and|with|for|to|then)\b|[,.!?;\n]|$)/i);
  return match?.[1] ? cleanEntityName(match[1]) : undefined;
}

function extractFirmName(message: string): string | undefined {
  const match = message.match(/\b(?:firm|investor|vc)\s+(?:called|named)?\s*([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4})/i);
  return match?.[1] ? cleanEntityName(match[1]) : undefined;
}

function extractStage(message: string): string | undefined {
  const match = message.match(/\b(lead|qualified|proposal|negotiation|won|lost|target|researched|drafted|contacted|replied|meeting|passed|committed)\b/i);
  if (!match?.[1]) return undefined;
  return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
}

function extractMoney(message: string): { amount?: number; currency?: string } {
  const match = message.match(/(?:([£$€])\s*)?(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?\s*(GBP|USD|EUR)?/);
  if (!match) return {};
  const symbol = match[1];
  const suffix = match[3];
  const code = match[4]?.toUpperCase();
  const multiplier = suffix?.toLowerCase() === "k" ? 1_000 : suffix?.toLowerCase() === "m" ? 1_000_000 : 1;
  const amount = Number(match[2].replace(/,/g, "")) * multiplier;
  const currency = code ?? (symbol === "£" ? "GBP" : symbol === "$" ? "USD" : symbol === "€" ? "EUR" : undefined);
  return Number.isFinite(amount) ? { amount, currency } : { currency };
}

function splitName(name: string): { firstName: string; lastName?: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? name.trim(),
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
  };
}

function inferState(userMessage?: string): ToolHydrationState {
  const state: ToolHydrationState = { userMessage };
  if (!userMessage?.trim()) return state;
  const money = extractMoney(userMessage);
  state.companyName = extractCompanyName(userMessage);
  state.contactName = extractContactName(userMessage);
  state.campaignName = extractCampaignName(userMessage);
  state.firmName = extractFirmName(userMessage);
  state.stage = extractStage(userMessage);
  state.amount = money.amount;
  state.currency = money.currency;
  const emailMatch = userMessage.match(EMAIL_RE);
  if (emailMatch?.[0]) state.recipientEmail = emailMatch[0].toLowerCase();
  return state;
}

export function createToolHydrationState(
  userMessage?: string,
  extras?: { roleKey?: string },
): ToolHydrationState {
  return { ...inferState(userMessage), roleKey: extras?.roleKey };
}

function mergeState(state: ToolHydrationState | undefined, userMessage?: string): ToolHydrationState {
  const inferred = inferState(userMessage ?? state?.userMessage);
  return { ...inferred, ...(state ?? {}) };
}

function defaultEmailBody(args: Record<string, unknown>, state: ToolHydrationState): string {
  const contact = String(args.recipientName ?? state.contactName ?? "there");
  const company = String(args.recipientOrganization ?? state.companyName ?? "your team");
  const amount = state.amount ? ` around ${state.currency ?? "GBP"} ${state.amount.toLocaleString()}` : "";
  return `Hi ${contact},\n\nI wanted to follow up on ${company}${amount ? ` and the opportunity${amount}` : ""}. Would you be open to a quick conversation this week?\n\nBest,\n${"AdeHQ"}`;
}

function defaultSections(
  title: string,
  state: ToolHydrationState,
  template?: string,
): Array<{ heading: string; body: string }> {
  return buildPdfSectionsFromMessage(state.userMessage ?? title, title, template);
}

export function hydrateToolCallArgs(
  tool: string,
  rawArgs: Record<string, unknown>,
  params?: {
    userMessage?: string;
    state?: ToolHydrationState;
  },
): Record<string, unknown> {
  const state = mergeState(params?.state, params?.userMessage);
  const args = { ...rawArgs };

  if (hasText(args.companyName)) state.companyName = args.companyName.trim();
  if (hasText(args.name) && tool === "crm.createCompany") state.companyName = args.name.trim();
  if (hasText(args.contactName)) state.contactName = args.contactName.trim();
  if (hasText(args.stage)) state.stage = args.stage.trim();
  if (typeof args.amount === "number") state.amount = args.amount;
  if (hasText(args.currency)) state.currency = args.currency.trim().toUpperCase();
  if (hasText(args.campaignName)) state.campaignName = args.campaignName.trim();
  if (hasText(args.firmName)) state.firmName = args.firmName.trim();

  switch (tool) {
    case "crm.createCompany": {
      if (!args.name && state.companyName) args.name = state.companyName;
      break;
    }
    case "crm.createContact": {
      const contactName = state.contactName ?? (hasText(args.fullName) ? args.fullName : undefined);
      if (!args.firstName && contactName) Object.assign(args, splitName(contactName));
      if (!args.companyName && state.companyName) args.companyName = state.companyName;
      if (!args.source) args.source = "AdeHQ chat";
      break;
    }
    case "crm.createDeal": {
      if (!args.companyName && state.companyName) args.companyName = state.companyName;
      if (!args.contactName && state.contactName) args.contactName = state.contactName;
      if (!args.amount && state.amount) args.amount = state.amount;
      if (!args.currency && state.currency) args.currency = state.currency;
      if (!args.stage && state.stage) args.stage = state.stage;
      if (!args.name) {
        const company = String(args.companyName ?? state.companyName ?? "New account");
        args.name = `${company} — ${String(args.stage ?? "opportunity").toLowerCase()} deal`;
      }
      break;
    }
    case "email.createDraft": {
      if (!args.recipientName && state.contactName) args.recipientName = state.contactName;
      if (!args.recipientOrganization && state.companyName) args.recipientOrganization = state.companyName;
      if (!args.recipientEmail && state.recipientEmail) args.recipientEmail = state.recipientEmail;
      if (!args.recipientEmail && state.userMessage) {
        const match = state.userMessage.match(EMAIL_RE);
        if (match?.[0]) args.recipientEmail = match[0].toLowerCase();
      }
      if (!args.subject) {
        args.subject = state.companyName
          ? `Quick follow-up — ${state.companyName}`
          : "Quick follow-up";
      }
      if (!args.body) args.body = defaultEmailBody(args, state);
      break;
    }
    case "email.sendDraft": {
      if (!args.draftId && state.inboxDraftId) args.draftId = state.inboxDraftId;
      if (!args.subject && state.emailSubject) args.subject = state.emailSubject;
      if (!args.recipientEmail && state.recipientEmail) args.recipientEmail = state.recipientEmail;
      if (!args.bodyPreview && state.emailBodyPreview) args.bodyPreview = state.emailBodyPreview;
      break;
    }
    case "tasks.createTask": {
      if (!args.title) {
        const contact = state.contactName ?? "the lead";
        const company = state.companyName ? ` re ${state.companyName}` : "";
        args.title = `Follow up with ${contact}${company}`;
      }
      if (!args.priority) args.priority = "medium";
      break;
    }
    case "artifact.createSpreadsheet": {
      const message = state.userMessage ?? "";
      const wantsLeadList =
        state.roleKey === "research" ||
        /\b(?:lead list|leads?|prospects?|shortlist|comps?|table of|as a table)\b/i.test(message);
      const wantsOpsTracker =
        /\b(?:sla|kpi|breach|ops|branch|week|tickets?|nps|revenue)\b/i.test(message);
      const template =
        args.template ??
        (wantsLeadList ? "lead_list" : wantsOpsTracker ? "market_research" : "sales_pipeline");
      if (!args.title) {
        args.title = wantsLeadList
          ? state.companyName
            ? `${state.companyName} lead list`
            : "Lead list"
          : firstSentence(message).slice(0, 72) ||
            (state.companyName ? `${state.companyName} pipeline summary` : "Ops workbook");
      }
      if (!args.template) args.template = template;
      const fromMessage = extractColumnList(message);
      if (!Array.isArray(args.columns) || !args.columns.length) {
        args.columns = fromMessage?.length
          ? fromMessage
          : wantsLeadList
            ? [
                "Name",
                "Company",
                "Area",
                "Portfolio",
                "Email / Phone",
                "Source URL",
                "Priority",
                "Why now",
              ]
            : wantsOpsTracker
              ? [
                  "Week",
                  "Team",
                  "Breaches",
                  "P1 count",
                  "P2 count",
                  "Mean time to restore (hrs)",
                  "Owner",
                  "Remediation",
                ]
              : ["Company", "Contact", "Stage", "Amount", "Currency", "Notes"];
      }
      const columns = args.columns as string[];
      const requested = extractRequestedCount(message) ?? (wantsOpsTracker ? 8 : wantsLeadList ? 6 : 4);
      if (!Array.isArray(args.rows) || args.rows.length < 2) {
        args.rows = buildSpreadsheetRowsFromMessage(message, columns, requested);
      }
      break;
    }
    case "social.createCampaign":
    case "calendar.createCampaign": {
      if (!args.name && state.campaignName) args.name = state.campaignName;
      if (!args.name) args.name = firstSentence(state.userMessage ?? "Content campaign").slice(0, 72);
      if (!args.description && state.userMessage) args.description = state.userMessage.trim();
      break;
    }
    case "social.draftPost":
    case "calendar.createContentPost": {
      if (!args.campaignName && state.campaignName) args.campaignName = state.campaignName;
      if (!args.title) args.title = firstSentence(state.userMessage ?? "Draft post").slice(0, 72);
      if (!args.body) args.body = state.userMessage ?? String(args.title);
      if (!args.platform) args.platform = "linkedin";
      break;
    }
    case "investor.createFirm": {
      if (!args.name && state.firmName) args.name = state.firmName;
      break;
    }
    case "investor.scoreFit": {
      if (!args.firmName && state.firmName) args.firmName = state.firmName;
      if (args.score == null) args.score = 75;
      break;
    }
    case "artifact.createPdfReport":
    case "artifact.createDocx": {
      const message = state.userMessage ?? "";
      if (!args.title) {
        args.title =
          firstSentence(message).slice(0, 72) ||
          (state.companyName ? `${state.companyName} brief` : "AdeHQ brief");
      }
      if (!args.template && tool === "artifact.createPdfReport") {
        if (detectVendorCompare(message) || state.roleKey === "research") {
          args.template = "market_research_report";
        }
      }
      if (!args.template && tool === "artifact.createDocx" && detectSowOrRfp(message)) {
        args.template = "business_brief";
      }
      if (!args.summary && message) args.summary = message.slice(0, 220);
      const thinSections =
        !Array.isArray(args.sections) ||
        !args.sections.length ||
        (args.sections as Array<{ body?: string }>).every(
          (section) => !String(section.body ?? "").trim() || String(section.body).length < 40,
        );
      if (thinSections) {
        args.sections = defaultSections(
          String(args.title),
          state,
          args.template ? String(args.template) : undefined,
        );
      }
      break;
    }
    case "artifact.createPresentation": {
      const message = state.userMessage ?? "";
      if (!args.title) {
        args.title =
          firstSentence(message).slice(0, 72) ||
          (state.companyName ? `${state.companyName} deck` : "AdeHQ deck");
      }
      if (!args.template) {
        args.template = detectVendorCompare(message) ? "research_brief" : "sales_deck";
      }
      const thinSlides =
        !Array.isArray(args.slides) ||
        args.slides.length < 3 ||
        (args.slides as Array<{ bullets?: unknown[] }>).every(
          (slide) => !Array.isArray(slide.bullets) || slide.bullets.length < 2,
        );
      if (thinSlides) {
        args.slides = buildPresentationSlidesFromMessage(message, String(args.title));
      }
      break;
    }
    case "artifact.updateSpreadsheet": {
      if (!args.title) args.title = "Updated spreadsheet";
      if (!Array.isArray(args.columns) || !args.columns.length) {
        args.columns = ["Item", "Status", "Notes"];
      }
      if (!Array.isArray(args.rows) || !args.rows.length) {
        args.rows = [[state.companyName ?? firstSentence(state.userMessage ?? "Update"), state.stage ?? "Updated", "Hydrated from chat request"]];
      }
      break;
    }
    case "artifact.convertFile":
    case "artifact.saveToDrive": {
      if (!args.title && state.companyName) args.title = `${state.companyName} export`;
      break;
    }
    case "team.coordinate": {
      if (!hasText(args.message) && state.userMessage) {
        args.message = state.userMessage.trim();
      }
      break;
    }
  }

  return coerceToolArgs(tool, args);
}

export function observeToolCallResult(
  tool: string,
  args: Record<string, unknown>,
  result: ToolCallResult,
  state: ToolHydrationState,
): void {
  if (hasText(args.companyName)) state.companyName = args.companyName.trim();
  if (tool === "crm.createCompany" && hasText(args.name)) state.companyName = args.name.trim();
  if (tool === "crm.createContact") {
    const fullName = [args.firstName, args.lastName].filter(hasText).join(" ").trim();
    if (fullName) state.contactName = fullName;
  }
  if (tool === "crm.createDeal") {
    if (hasText(args.name)) state.dealName = args.name.trim();
    if (typeof args.amount === "number") state.amount = args.amount;
    if (hasText(args.currency)) state.currency = args.currency.trim().toUpperCase();
    if (hasText(args.stage)) state.stage = args.stage.trim();
  }
  if (tool === "social.createCampaign" || tool === "calendar.createCampaign") {
    if (hasText(args.name)) state.campaignName = args.name.trim();
  }
  if (tool === "investor.createFirm" && hasText(args.name)) state.firmName = args.name.trim();

  if (result.status === "success") {
    const payload = result.output?.payload ?? {};
    if (hasText(payload.companyName)) state.companyName = payload.companyName.trim();
    if (hasText(payload.fullName)) state.contactName = payload.fullName.trim();
    if (tool === "email.createDraft") {
      const draftId = payload.inboxDraftId ?? payload.draftId;
      if (hasText(draftId)) state.inboxDraftId = String(draftId).trim();
      if (hasText(payload.subject)) state.emailSubject = String(payload.subject).trim();
      if (hasText(payload.recipientEmail)) {
        state.recipientEmail = String(payload.recipientEmail).trim().toLowerCase();
      }
      if (hasText(payload.body)) {
        state.emailBodyPreview = String(payload.body).trim().slice(0, 4000);
      }
    }
  }
}
