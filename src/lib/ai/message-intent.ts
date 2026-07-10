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
  /\b(?:add|create|creating|make|making|draft|drafting|write|writing|send|sending|log|logging|schedule|scheduling|set ?up|setting ?up|build|building|generate|generating|update|updating|put)\b/i;

const TOOL_WORK_NOUN =
  /\b(?:crm|contacts?|leads?|deals?|pipelines?|emails?|outreach|tasks?|to-?dos?|follow[- ]ups?|reminders?|campaigns?|posts?|calendar|meetings?|invoices?|spreadsheets?|decks?|slides?|reports?|docs?|documents?|pdfs?|memos?|prds?|proposals?|briefs?)\b/i;

export function messageLikelyNeedsStructuredEffects(message: string): boolean {
  return TOOL_WORK_VERB.test(message) && TOOL_WORK_NOUN.test(message);
}
