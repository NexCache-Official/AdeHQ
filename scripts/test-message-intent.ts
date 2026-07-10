import { messageLikelyNeedsStructuredEffects } from "@/lib/ai/message-intent";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Exact repro: verb and noun separated by 70+ characters of name/company/email —
// the original 40-char-proximity regex missed this, silently routing a real CRM
// request onto the plain-prose streaming path (which hardcodes empty effects
// with no toolCalls field at all), so the action was never even attempted.
assert(
  messageLikelyNeedsStructuredEffects(
    "Add Marcus Webb (Webb Realty Group, marcus@webbrealty.com) as a CRM contact.",
  ),
  "must detect CRM contact request with a long clause between verb and noun",
);

assert(
  messageLikelyNeedsStructuredEffects(
    "Just add the CRM contact: Marcus Webb, buyer's agent at Webb Realty Group, email marcus@webbrealty.com. No PDF needed right now.",
  ),
  "must detect a long, multi-clause CRM request",
);

assert(
  messageLikelyNeedsStructuredEffects(
    "Add a CRM contact: Marcus Webb, buyer's agent at Webb Realty Group, email marcus@webbrealty.com. Log a deal for the Riverside Commons purchase at $7.55M in the Negotiation stage. Then generate a one-page PDF deal summary I can send to my partners.",
  ),
  "must detect a multi-action CRM + deal + PDF request",
);

assert(
  messageLikelyNeedsStructuredEffects("Create a follow-up task for tomorrow."),
  "must detect a simple, short task-creation request",
);

assert(
  messageLikelyNeedsStructuredEffects("Please schedule a reminder to check on the escrow."),
  "must detect a scheduling request",
);

// Conversational / advice questions must NOT trigger the structured/blocking
// path — these are exactly what Phase 4 streaming should cover.
assert(
  !messageLikelyNeedsStructuredEffects(
    "Should I bring my lawyer to tomorrow's meeting or keep it informal for this first round?",
  ),
  "advice question must not be treated as tool-work",
);
assert(
  !messageLikelyNeedsStructuredEffects("hey! how's it going?"),
  "greeting must not be treated as tool-work",
);
assert(
  !messageLikelyNeedsStructuredEffects(
    "Walk me through the actual math — if I open at $7.3M and they counter at $7.9M, what's my ideal next move?",
  ),
  "negotiation-math question must not be treated as tool-work",
);

console.log("✓ CRM/task/artifact requests with long intervening clauses are detected");
console.log("✓ conversational/advice questions are not mistaken for tool-work");
console.log("All message-intent tests passed.");
