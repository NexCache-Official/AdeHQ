/**
 * Quick invariants for mailbox local-part validation.
 *   npx tsx scripts/test-inbox-local-part.ts
 */
import { validateLocalPart } from "../src/lib/inbox/local-part";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const reject = [
  "adehq",
  "adehq-support",
  "team-adehq",
  "nexcache",
  "maya",
  "maya-bot",
  "admin",
  "support",
  "fuck",
  "f4ck",
  "shithead",
  "nigger",
  "rape",
  "my-rape",
  "asshole",
  "xxx",
  "hitler",
];

const allow = [
  "acme",
  "acme-tools",
  "scrape",
  "grape",
  "raccoon",
  "northstar",
  "ops-desk",
  "launchroom",
];

for (const value of reject) {
  const result = validateLocalPart(value);
  assert(!result.ok, `expected reject: ${value} → ${JSON.stringify(result)}`);
}

for (const value of allow) {
  const result = validateLocalPart(value);
  assert(result.ok, `expected allow: ${value} → ${JSON.stringify(result)}`);
}

console.log(`ok — ${reject.length} rejected, ${allow.length} allowed`);
