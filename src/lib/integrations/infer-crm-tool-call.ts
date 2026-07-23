import type { ToolCallEffect } from "@/lib/integrations/types";

function parseAmount(message: string): { amount?: number; currency?: string } {
  const match = message.match(/([$£€])\s*([\d,.]+)|\b(USD|GBP|EUR)\s*([\d,.]+)/i);
  if (!match) return {};
  const raw = match[2] ?? match[4] ?? "";
  const amount = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return {};
  const currency =
    match[1] === "£"
      ? "GBP"
      : match[1] === "€"
        ? "EUR"
        : match[3]?.toUpperCase() ?? "USD";
  return { amount, currency };
}

function parseCompanyName(message: string): string | null {
  const match = message.match(
    /\b(?:deal|pipeline|opportunity)\s+for\s+(.+?)(?=,\s*(?:[A-Z]{2}|[A-Z][a-z]+\b)|[.!?]|\s+(?:worth|valued|at|for)\s+[$£€]|\s+(?:do|perform|conduct|research|look|search)\b)/i,
  );
  if (match?.[1]) return match[1].trim();

  const crmFor = message.match(
    /\b(?:add|create|log)\b[\s\S]{0,50}\b(?:crm|deal|pipeline)\b[\s\S]{0,30}\bfor\s+([^,.!?]+)/i,
  );
  return crmFor?.[1]?.trim() || null;
}

/** Conservative last-resort for explicit "create/add/log CRM deal" requests. */
export function inferRequiredCrmToolCalls(message: string): ToolCallEffect[] {
  const text = message.trim();
  const explicitDeal =
    /\b(?:add|create|log|open)\b/i.test(text) &&
    /\b(?:crm\s+)?(?:deal|pipeline|opportunity)\b/i.test(text);
  if (!explicitDeal) return [];

  const companyName = parseCompanyName(text);
  if (!companyName) return [];

  const { amount, currency } = parseAmount(text);
  const purpose =
    text.match(
      /(?:[$£€]\s*[\d,.]+|\b(?:USD|GBP|EUR)\s*[\d,.]+)\s+([a-z][a-z0-9 &'’/-]{2,80}?)\s+(?:deal|opportunity)\b/i,
    )?.[1]?.trim() ?? "pipeline opportunity";

  return [
    {
      tool: "crm.createDeal",
      mode: "execute",
      args: {
        name: `${companyName} — ${purpose}`,
        ...(amount != null ? { amount } : {}),
        ...(currency ? { currency } : {}),
        stage: "Lead",
        companyName,
        notes:
          "Created from the user's explicit CRM instruction. Deal terms are user-supplied; verify any researched business details against the attached sources.",
      },
    },
  ];
}
