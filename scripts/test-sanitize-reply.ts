import { sanitizeReplyForChat } from "@/lib/ai/normalize-model-response";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Exact repro from the room collaboration test: the model wrote clean prose,
// then leaked a YAML-like dump of its intended tool calls directly into the
// same reply string instead of populating effects.toolCalls.
const leaked =
  "I'll own the spec. Drafting a lean internal deal tracker doc now — pipeline stages, key date fields, negotiation notes, and a lightweight user flow. Once it lands in Drive, I'll hand it to Elena for review." +
  "@Elena Rossi — I'll ping you with the doc in a dedicated topic so you can tear it apart." +
  "effects.toolCalls:tool: artifact.createDocx  mode: execute\n  args:\n    title: \"Deal Tracker Product Spec\"\n    template: \"business_brief\"\n" +
  "tool: team.coordinate  mode: execute\n  args:\n    employeeName: \"Elena Rossi\"\n" +
  "tool: tasks.createTask  mode: execute\n  args:\n    title: \"Review deal tracker product spec\"";

const cleaned = sanitizeReplyForChat(leaked);
assert(!cleaned.includes("effects.toolCalls"), "must strip the effects.toolCalls leak marker");
assert(!cleaned.includes("tool: artifact.createDocx"), "must strip the leaked tool schema body");
assert(!cleaned.includes("mode: execute"), "must strip leaked mode: execute lines");
assert(
  cleaned.includes("I'll own the spec") && cleaned.includes("tear it apart"),
  "must preserve the clean prose that came before the leak",
);
console.log("✓ strips a real schema-leak repro while preserving the clean prose prefix");

// Bare "effects: {" leak (alternate model phrasing) — also must be stripped.
const bareEffects = "Sounds good, I'm on it. effects: { \"toolCalls\": [ { \"tool\": \"tasks.createTask\" } ] }";
const cleanedBare = sanitizeReplyForChat(bareEffects);
assert(!cleanedBare.includes("effects:"), "must strip a bare effects: { leak");
assert(cleanedBare.includes("Sounds good"), "must keep the clean prefix for the bare-effects case");
console.log("✓ strips a bare 'effects: {' leak variant");

// If literally nothing survives stripping, fall back to a safe generic reply
// instead of an empty bubble.
const onlyLeak = "effects.toolCalls: tool: crm.createContact mode: execute args: { }";
const cleanedOnly = sanitizeReplyForChat(onlyLeak);
assert(cleanedOnly.trim().length > 0, "must never return an empty reply");
assert(!cleanedOnly.includes("effects.toolCalls"), "fallback text must not itself contain the leak");
console.log("✓ falls back to safe generic text when the whole reply was leak");

// False-positive guard: ordinary business prose mentioning "effects" or "tool"
// in a normal sentence must NOT be mangled.
const normalProse =
  "Bringing a lawyer to an initial meeting can have negative effects on rapport — I'd keep it informal. " +
  "Comps are a useful tool: use them to justify your counter.";
const cleanedNormal = sanitizeReplyForChat(normalProse);
assert(
  cleanedNormal === normalProse,
  `normal prose must pass through unchanged, got: ${cleanedNormal}`,
);
console.log("✓ does not mangle ordinary prose containing the words 'effects' or 'tool'");

// A clean reply with zero markup passes through byte-for-byte.
const plain = "Counter with $7.55M and hold your walk-away at $7.7M.";
assert(sanitizeReplyForChat(plain) === plain, "clean plain text must pass through unchanged");
console.log("✓ clean plain-text replies pass through unchanged");

console.log("All sanitize-reply schema-leak tests passed.");
