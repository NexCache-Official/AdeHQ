// ===========================================================================
// Prompt builder — documents the integration tools an employee is granted,
// generated from the registry so prompts never drift from real capabilities.
// ===========================================================================

import type { IntegrationEmployee } from "./types";
import { listToolDefinitions } from "./registry/tool-definitions";
import { catalogToolIdForDomain } from "./registry/capabilities";
import { suggestedCapabilityToolIds } from "./registry/prefab-toolsets";
import { CAPABILITY_DOMAINS, INTERNAL_CAPABILITY_TOOL_IDS } from "./registry/capabilities";

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

/**
 * Compact list of the tool usage docs an employee may call (one per line).
 * Used by the autonomy engine's tool catalog. Includes tools that need a
 * human Allow once / Always allow so the model can still emit the call.
 */
export function listGrantedToolUsage(_employee: IntegrationEmployee): string {
  return listToolDefinitions()
    .map((tool) => `- ${tool.promptUsage}`)
    .join("\n");
}

/** Build the "Integration tools" prompt block, or "" when nothing is registered. */
export function buildIntegrationToolsPrompt(employee: IntegrationEmployee): string {
  const grantedToolIds = effectiveCapabilityToolIds(employee);
  const allTools = listToolDefinitions();
  if (!allTools.length) return "";

  const granted = allTools.filter((tool) =>
    grantedToolIds.has(catalogToolIdForDomain(tool.domain)),
  );
  const needsPermission = allTools.filter(
    (tool) => !grantedToolIds.has(catalogToolIdForDomain(tool.domain)),
  );

  const availableNames = new Set(allTools.map((tool) => tool.name));
  const grantedDocs = granted.map((tool) => `- ${tool.promptUsage}`).join("\n");
  const lockedDocs = needsPermission
    .map((tool) => {
      const label = CAPABILITY_DOMAINS[tool.domain]?.label ?? tool.domain;
      return `- ${tool.promptUsage}  ⟶ needs ${label} access (still emit the toolCall — the system will ask the human Allow once / Always allow)`;
    })
    .join("\n");

  const hasSalesBundleExample = [
    "crm.createCompany",
    "crm.createContact",
    "crm.createDeal",
    "email.createDraft",
    "tasks.createTask",
    "artifact.createSpreadsheet",
  ].every((tool) => availableNames.has(tool));
  const artifactAsyncTools = [
    "artifact.createSpreadsheet",
    "artifact.createPdfReport",
    "artifact.createDocx",
    "artifact.createPresentation",
    "artifact.convertFile",
    "artifact.updateSpreadsheet",
    "artifact.saveToDrive",
    "image.create",
    "image.edit",
    "image.regenerate",
  ].filter((tool) => availableNames.has(tool));
  const salesBundleExample = hasSalesBundleExample
    ? `
- Example for "create a company, add a contact, log a deal, draft an email, add a follow-up task, make a spreadsheet": emit crm.createCompany, crm.createContact, crm.createDeal, email.createDraft, tasks.createTask, and artifact.createSpreadsheet in effects.toolCalls.
- Example for "Send a mail to jane@acme.com asking how she's doing": emit email.createDraft then email.sendDraft in the same effects.toolCalls. Never reply that you cannot send email from chat when these tools are listed.
- To check recent inbox mail: email.listRecent, then email.getThread for a specific thread.

Complete Sales bundle example for "Create a company called GreenEdge Robotics, add Praveen as the contact, log a £5,000 qualified deal, draft an outreach email, create a follow-up task, and make a spreadsheet summary":
[
  { "tool": "crm.createCompany", "mode": "execute", "args": { "name": "GreenEdge Robotics" } },
  { "tool": "crm.createContact", "mode": "execute", "args": { "firstName": "Praveen", "companyName": "GreenEdge Robotics", "source": "AdeHQ chat" } },
  { "tool": "crm.createDeal", "mode": "execute", "args": { "name": "GreenEdge Robotics — pilot deal", "amount": 5000, "currency": "GBP", "stage": "Qualified", "contactName": "Praveen", "companyName": "GreenEdge Robotics" } },
  { "tool": "email.createDraft", "mode": "execute", "args": { "subject": "Quick follow-up — GreenEdge Robotics", "body": "Hi Praveen,\\n\\nI wanted to follow up on GreenEdge Robotics and the pilot opportunity. Would you be open to a quick conversation this week?\\n\\nBest,", "recipientName": "Praveen", "recipientEmail": "praveen@greenedge.example", "recipientOrganization": "GreenEdge Robotics" } },
  { "tool": "tasks.createTask", "mode": "execute", "args": { "title": "Follow up with Praveen re GreenEdge Robotics", "description": "Follow up on the £5,000 qualified deal.", "priority": "medium" } },
  { "tool": "artifact.createSpreadsheet", "mode": "execute", "args": { "title": "GreenEdge Robotics pipeline summary", "template": "sales_pipeline", "columns": ["Company", "Contact", "Stage", "Amount", "Currency", "Notes"], "rows": [["GreenEdge Robotics", "Praveen", "Qualified", 5000, "GBP", "Created from sales chat"]] } }
]

Send-email example for "Send a mail to skumar@nexcache.com asking Shubham how he's doing":
[
  { "tool": "email.createDraft", "mode": "execute", "args": { "subject": "Quick check-in", "body": "Hi Shubham,\\n\\nJust wanted to check in and see how you're doing — hope life's treating you well.\\n\\nBest,", "recipientName": "Shubham", "recipientEmail": "skumar@nexcache.com" } },
  { "tool": "email.sendDraft", "mode": "execute", "args": { "draftId": "<use inboxDraftId from createDraft result — the runtime hydrates this when omitted>" } }
]

Research lead-list example for "Give me 5 Zone 2 flat leads under £900k as a table spreadsheet":
[
  { "tool": "artifact.createSpreadsheet", "mode": "execute", "args": { "title": "Zone 2 flats under £900k — lead list", "template": "lead_list", "columns": ["Name", "Company", "Area", "Portfolio", "Email / Phone", "Source URL", "Priority", "Why now"], "rows": [["James Whitfield", "Whitfield Properties Ltd", "Stratford", "3 flats", "—", "https://example.com", "H", "Active buyer — looking to expand Zone 2"]] } }
]`
    : "";
  const imageToolsAvailable =
    availableNames.has("image.create") ||
    availableNames.has("image.edit") ||
    availableNames.has("image.regenerate");
  const imageRule = imageToolsAvailable
    ? `

Image artifacts (Drive-backed — never chat-only pixels):
- Actions (member language only — never name models): Create image (~0.5 WH), Create business graphic (~2 WH), Edit image (~4 WH), Create premium visual (~6 WH).
- Ask clarifying questions first (subject, any on-image text, style, aspect, brand constraints). Offer fair WH options before generating.
- Standard Create image / business graphic: no confirmation unless Work Hours are low — then ask once.
- Create premium visual and Edit image: always state the WH estimate and wait for agreement (then call with confirmed:true).
- Every generation becomes a Drive artifact with prompt provenance + version history; use image.regenerate / image.edit for revisions.
- Another employee can reuse the Drive export / artifact — link taskId when the work belongs to a task.`
    : "";
  const asyncArtifactRule = artifactAsyncTools.length
    ? `\n- ${artifactAsyncTools.join(", ")} run in the background — tell the user the file is generating and will appear in Drive when ready.
- artifact.createSpreadsheet / createPdfReport / createDocx / createPresentation and image.create / image.edit / image.regenerate already save binaries to Drive. Never also call artifact.saveToDrive in the same turn — that creates a duplicate "Generating Drive export…" chip.${imageRule}`
    : imageRule;

  const teamworkRule = availableNames.has("team.coordinate")
    ? `

Working with teammates (this is a shared workspace — it's yours too):
- You can pull in another AI employee when the work is theirs to own. First identify the right person by role; use team.suggestColleagues if unsure.
- To hand off or co-work, call team.coordinate with { "employeeName", "message", "topicHint"? }. It finds a room you both belong to, brings it up there, and gets them started — like walking over and saying "hey, can you take this?".
- You and other AI employees only talk in shared GROUP rooms, never in DMs. A DM is between you and a human. If you don't share a room with someone, say so and suggest the human add you both to one.
- Keep coordination on-topic: it defaults to the room's general chat; pass "topicHint" to land in a relevant existing topic instead. Suggest spinning up a dedicated topic when a thread gets deep.
- When the user says "coordinate with X", "loop in X", "get X to…", or the task clearly needs another discipline (design, research, pricing, engineering), delegate with team.coordinate rather than trying to do their job yourself.
- After delegating, tell the user where you took it (which room) and what you asked for.`
    : "";

  const lockedSection = lockedDocs
    ? `

Tools that need permission right now (still emit toolCalls — do not refuse politely and stop):
${lockedDocs}
When you emit one of these, also briefly ask in your reply for Allow once or Always allow (iPhone-style). The system attaches a request card. After the human answers, continue the task.`
    : "";

  return `Integration tools (effects.toolCalls) — you can DO real work, not just describe it:
You have access to these AdeHQ tools. To use one, add an entry to effects.toolCalls:
  { "tool": "crm.createContact", "mode": "execute", "args": { ... } }

Tools you can use now:
${grantedDocs || "(none permanently granted — use the needs-permission list below and ask)"}
${lockedSection}

CRITICAL — actions only happen through effects.toolCalls:
- Writing "Created X", "Added Y", "Logged the deal", "Drafted the email", or "Generated the spreadsheet" in your reply does NOTHING on its own. The ONLY way anything is saved is by emitting a matching entry in effects.toolCalls in THIS SAME response.
- If the user asks you to create a company, contact, deal, task, email draft, or spreadsheet, you MUST include one effects.toolCalls entry per action. One reply can carry several tool calls at once.
- NEVER claim in your reply that something was created/added/logged/drafted/generated unless effects.toolCalls contains the matching call. If you cannot emit the tool call, say what you could not do — do not pretend it happened.
- If a tool needs permission, still emit the toolCall. Ask conversationally for Allow once / Always allow / Not now. Do not invent a workaround that pretends the action succeeded.
${salesBundleExample}

Tool call rules:
- Every toolCall MUST include a non-empty "args" object with every required field for that tool. Do not put fields like name, firstName, columns, rows, subject, or title at the root of the toolCall — they belong inside args.
- "mode": "execute" runs internal AdeHQ tools immediately when the user explicitly asked for the action (contacts, companies, deals, tasks, email drafts, lists).
- "mode": "preview" does NOT run the action — it creates an approval card. Use preview only when the user asked to review first, or for external sends/publishes/deletes — not for routine internal CRM records the user explicitly requested.
- Wording: say "created" only when mode was execute and the tool succeeded. Say "prepared for approval" when preview/approval_pending. Say "generating" for queued artifact jobs. Say you need access when blocked awaiting Allow once / Always. Never say "created" and "waiting for approval" for the same object.
- Tool result cards (CRM records, tasks, drafts, receipts) attach to your message automatically — do NOT also add duplicate workLog entries for the same tool call.
- Never invent tool names or args not listed above.
- When you create a contact and a deal in the same reply, use "contactName" on the deal so they link.
- Use tasks.createTask for follow-ups instead of only mentioning them in text.
- NEVER write "effects", "toolCalls", "tool:", "mode:", or "args:" as literal text inside "reply" — those are backend-only JSON fields the user never sees. If you are about to describe a tool call in words, stop and put it in the real effects.toolCalls array instead. "reply" is spoken words only, never schema.
- Before finishing your response, check: does "reply" say or imply you added/created/logged/drafted/generated/updated something (in any tense — "adding", "added", "I'll add", etc.)? If yes, effects.toolCalls MUST contain a matching entry, or you must rewrite "reply" to say what's blocking it instead. Never let the words promise more than effects.toolCalls actually contains.
${asyncArtifactRule}${teamworkRule}`;
}
