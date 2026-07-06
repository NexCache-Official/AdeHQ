// ===========================================================================
// Prompt builder — documents the integration tools an employee is granted,
// generated from the registry so prompts never drift from real capabilities.
// ===========================================================================

import type { IntegrationEmployee } from "./types";
import { listToolDefinitions } from "./registry/tool-definitions";
import { catalogToolIdForDomain } from "./registry/capabilities";
import { suggestedCapabilityToolIds } from "./registry/prefab-toolsets";
import { INTERNAL_CAPABILITY_TOOL_IDS } from "./registry/capabilities";

/**
 * Resolve the granted catalog tool ids, mirroring the executor's self-heal:
 * employees with no internal capability rows fall back to their role prefab,
 * so prompt and execution stay consistent before the first run seeds rows.
 */
function effectiveCapabilityToolIds(employee: IntegrationEmployee): Set<string> {
  const explicit = employee.tools
    .filter(
      (t) => INTERNAL_CAPABILITY_TOOL_IDS.includes(t.toolId) && t.permission !== "none",
    )
    .map((t) => t.toolId);
  if (explicit.length) return new Set(explicit);
  return new Set(suggestedCapabilityToolIds(employee.roleKey));
}

/** Build the "Integration tools" prompt block, or "" when nothing is granted. */
export function buildIntegrationToolsPrompt(employee: IntegrationEmployee): string {
  const grantedToolIds = effectiveCapabilityToolIds(employee);
  if (!grantedToolIds.size) return "";

  const available = listToolDefinitions().filter((tool) =>
    grantedToolIds.has(catalogToolIdForDomain(tool.domain)),
  );
  if (!available.length) return "";

  const toolDocs = available.map((tool) => `- ${tool.promptUsage}`).join("\n");

  return `Integration tools (effects.toolCalls) — you can DO real work, not just describe it:
You have access to these AdeHQ tools. To use one, add an entry to effects.toolCalls:
  { "tool": "crm.createContact", "mode": "execute", "args": { ... } }

Available tools:
${toolDocs}

CRITICAL — actions only happen through effects.toolCalls:
- Writing "Created X", "Added Y", "Logged the deal", "Drafted the email", or "Generated the spreadsheet" in your reply does NOTHING on its own. The ONLY way anything is saved is by emitting a matching entry in effects.toolCalls in THIS SAME response.
- If the user asks you to create a company, contact, deal, task, email draft, or spreadsheet, you MUST include one effects.toolCalls entry per action. One reply can carry several tool calls at once.
- NEVER claim in your reply that something was created/added/logged/drafted/generated unless effects.toolCalls contains the matching call. If you cannot emit the tool call, say what you could not do — do not pretend it happened.
- Example for "create a company, add a contact, log a deal, draft an email, add a follow-up task, make a spreadsheet": emit crm.createCompany, crm.createContact, crm.createDeal, email.createDraft, tasks.createTask, and artifact.createSpreadsheet in effects.toolCalls.

Tool call rules:
- "mode": "execute" runs internal AdeHQ tools immediately when the user explicitly asked for the action (contacts, companies, deals, tasks, email drafts, lists).
- "mode": "preview" does NOT run the action — it creates an approval card. Use preview only when the user asked to review first, or for external sends/publishes/deletes — not for routine internal CRM records the user explicitly requested.
- Wording: say "created" only when mode was execute and the tool succeeded. Say "prepared for approval" when preview/approval_pending. Say "generating" for queued artifact jobs. Never say "created" and "waiting for approval" for the same object.
- Tool result cards (CRM records, tasks, drafts, receipts) attach to your message automatically — do NOT also add duplicate workLog entries for the same tool call.
- Never invent tool names or args not listed above. If a needed tool is missing, say so.
- When you create a contact and a deal in the same reply, use "contactName" on the deal so they link.
- Use tasks.createTask for follow-ups instead of only mentioning them in text.
- artifact.createSpreadsheet and artifact.createPdfReport run in the background — tell the user the file is generating and will appear in Drive when ready.`;
}
