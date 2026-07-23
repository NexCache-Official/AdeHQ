import {
  messageLikelyNeedsStructuredEffects,
  messageLikelyNeedsResearch,
  isShortToolRetryMessage,
  conversationLikelyNeedsStructuredEffects,
} from "@/lib/ai/message-intent";

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

// Regression: "try again now" was missed by the old strictly-anchored retry
// regex (it only matched "try again" with no trailing word), which let the
// message fall through to the plain-prose stream path and the model
// re-refused a request it never actually attempted.
assert(
  isShortToolRetryMessage("try again now"),
  "must recognize 'try again now' as a retry despite the trailing word",
);
assert(
  isShortToolRetryMessage("do it now please"),
  "must recognize 'do it now please' as a retry with multiple trailing fillers",
);
assert(isShortToolRetryMessage("try again"), "must still recognize the bare phrase");

// Regression: "did you send it?" style status/confirmation questions must
// also route onto the structured path — otherwise the model answers from a
// context-free turn and claims it can never send email, even though nothing
// was ever actually attempted.
assert(
  isShortToolRetryMessage("did you send it?"),
  "must recognize a status/confirmation question as needing prior tool-ask context",
);
assert(isShortToolRetryMessage("was it sent?"), "must recognize 'was it sent?'");
assert(isShortToolRetryMessage("did it go through?"), "must recognize 'did it go through?'");
assert(
  !isShortToolRetryMessage("did the deal move to negotiation stage?"),
  "an unrelated 'did' question must not be misclassified as a status query",
);

const emailAskHistory = [
  {
    senderType: "human",
    content:
      "Send a mail to skumar@nexcache.com asking Shubham how hes doing, just a general life check up mail.",
  },
  { senderType: "ai", content: "Hey Shubham — quick heads up: I can draft the email..." },
];
assert(
  conversationLikelyNeedsStructuredEffects("try again now", emailAskHistory),
  "'try again now' after an email ask must resolve to needing structured effects",
);
assert(
  conversationLikelyNeedsStructuredEffects("did you send it?", emailAskHistory),
  "'did you send it?' after an email ask must resolve to needing structured effects",
);

console.log("✓ short retries and status queries route onto the structured tool path");

assert(
  messageLikelyNeedsResearch("Could you perform some research on Tesla?"),
  "must detect a research ask",
);
assert(
  messageLikelyNeedsStructuredEffects("Can you perform a quick Google search?"),
  "google search must take the structured / non-stream path",
);
assert(
  conversationLikelyNeedsStructuredEffects("Yes.", [
    { senderType: "human", content: "I would like for you to review the recent financials please." },
    {
      senderType: "ai",
      content: "Want me to pull the key figures into a quick summary?",
    },
  ]),
  "'Yes' after a financials ask must keep the structured path",
);

console.log("✓ research / google / yes-follow-up intents are detected");
console.log("All message-intent tests passed.");
