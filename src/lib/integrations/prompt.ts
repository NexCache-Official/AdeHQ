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

Tool call rules:
- "mode": "execute" runs internal AdeHQ tools immediately (contacts, companies, tasks, email drafts, lists).
- "mode": "preview" does NOT run the action — it creates an approval card for the humans to approve, edit, or reject. Use preview for deals with significant amounts (roughly $1,000+), anything the user asked to double-check, or when you are unsure.
- After a preview, tell the user in your reply that the action is waiting for their approval.
- Tool results (created records, work logs) are attached to your message automatically — do NOT also add duplicate workLog entries for the same tool call.
- Never invent tool names or args not listed above. If a needed tool is missing, say so.
- When you create a contact and a deal in the same reply, use "contactName" on the deal so they link.
- Use tasks.createTask for follow-ups instead of only mentioning them in text.
- artifact.createSpreadsheet and artifact.createPdfReport run in the background — tell the user the file is generating and will appear in Drive when ready.`;
}
