/**
 * Detects messages that likely need the model to emit structured effects (create
 * a CRM record, draft/send an email, create a task, schedule a post, build an
 * artifact). Shared by the streaming-eligibility gate (these stay on the
 * blocking structured path — the plain-prose streaming path hardcodes EMPTY
 * effects with no toolCalls field at all, so a false negative here means a real
 * CRM/task/artifact request silently never attempts the action) and the
 * output-token-cap heuristic (these need a healthy token floor even when the
 * user's message itself is short).
 *
 * Deliberately permissive: verb and object are matched independently anywhere in
 * the message, NOT required to be adjacent. A real request often has a name,
 * company, and email address sitting between the verb and the noun ("Add Marcus
 * Webb, Webb Realty Group, marcus@webbrealty.com, as a CRM contact" — "Add" and
 * "contact" are 70+ characters apart). A false negative here silently breaks a
 * real action; a false positive only costs a slightly slower reply on the
 * blocking path — so this must err toward over-matching, not under-matching.
 */
const TOOL_WORK_VERB =
  /\b(?:add|create|creating|make|making|draft|drafting|write|writing|send|sending|log|logging|schedule|scheduling|set ?up|setting ?up|build|building|generate|generating|update|updating|put|find|prepare|compile|produce|export)\b/i;

const TOOL_WORK_NOUN =
  /\b(?:crm|contacts?|leads?|deals?|pipelines?|emails?|outreach|tasks?|to-?dos?|follow[- ]ups?|reminders?|campaigns?|posts?|calendar|meetings?|invoices?|spreadsheets?|workbooks?|tables?|xlsx|csv|trackers?|decks?|presentations?|slides?|reports?|docs?|documents?|pdfs?|memos?|prds?|specs?|specifications?|proposals?|briefs?|artifacts?)\b/i;

/**
 * Verb-less delivery asks still need tools — e.g. "Lead list spreadsheet in Drive
 * — columns: …" has spreadsheet/leads/Drive but no create/make verb. Without this
 * the plain-prose stream path runs, the model invents [TOOL_CALL] text, and
 * nothing is saved.
 */
const ARTIFACT_DELIVERY_INTENT =
  /\b(?:spreadsheets?|workbooks?|xlsx|csv|lead[- ]?lists?|trackers?|artifacts?|tables?)\b[\s\S]{0,120}\b(?:drive|columns?|rows?|sheet|open from|saved? to)\b|\b(?:drive|columns?|rows?)\b[\s\S]{0,120}\b(?:spreadsheets?|workbooks?|xlsx|csv|lead[- ]?lists?|trackers?|tables?|artifacts?)\b/i;

const CRM_OR_TASK_DELIVERY_INTENT =
  /\b(?:crm|contacts?|deals?|companies|tasks?|follow[- ]ups?)\b[\s\S]{0,100}\b(?:add|create|log|save|update|new)\b|\b(?:add|create|log|save|update|new)\b[\s\S]{0,100}\b(?:crm|contacts?|deals?|companies|tasks?|follow[- ]ups?)\b/i;

export function messageLikelyNeedsStructuredEffects(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (TOOL_WORK_VERB.test(text) && TOOL_WORK_NOUN.test(text)) return true;
  if (ARTIFACT_DELIVERY_INTENT.test(text)) return true;
  if (CRM_OR_TASK_DELIVERY_INTENT.test(text)) return true;
  return false;
}
