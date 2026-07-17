/**
 * Canonical local-part validation for mailbox claiming.
 * Reserved = brand / system / role names nobody may claim.
 * Blocked = abuse / slurs (exact segments + longer substrings).
 */

/** Exact local-parts that are never claimable. */
export const RESERVED_LOCAL_PARTS = new Set([
  // Brand / AdeHQ product
  "adehq",
  "ade-hq",
  "ade",
  "hq",
  "nexcache",
  "nex-cache",
  "maya",
  "adehq-team",
  "adehq-support",
  "adehq-billing",
  "adehq-security",
  "adehq-mail",
  "adehq-inbox",
  "official",
  "verified",

  // System / RFC / ops
  "admin",
  "administrator",
  "root",
  "system",
  "sysadmin",
  "postmaster",
  "mailer-daemon",
  "daemon",
  "hostmaster",
  "webmaster",
  "abuse",
  "security",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "bounce",
  "bounces",
  "mailer",

  // Common role / support inboxes we keep platform-owned
  "support",
  "help",
  "helpdesk",
  "billing",
  "invoice",
  "invoices",
  "payments",
  "payment",
  "sales",
  "contact",
  "info",
  "hello",
  "team",
  "staff",
  "owners",
  "owner",
  "founders",
  "founder",
  "ceo",
  "legal",
  "compliance",
  "privacy",
  "gdpr",
  "dmca",
  "copyright",
  "trust",
  "safety",
  "moderation",
  "moderator",
  "notifications",
  "notification",
  "alerts",
  "status",
  "ops",
  "operations",
  "devops",
  "engineering",
  "success",
  "customersuccess",
  "customer-success",
  "newsletter",
  "marketing",
  "press",
  "media",
  "jobs",
  "careers",
  "hr",
  "people",
  "api",
  "www",
  "ftp",
  "null",
  "undefined",
  "test",
  "testing",
  "demo",
  "example",
  "sample",
]);

/**
 * Longer tokens — safe to reject as substrings anywhere in the local-part.
 * Keep these ≥4 chars where possible to limit false positives.
 */
const BLOCKED_SUBSTRINGS = [
  "fuck",
  "fucking",
  "motherfuck",
  "fck",
  "fuk",
  "fack",
  "shit",
  "bullshit",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "fagot",
  "retard",
  "retarded",
  // "rape" alone false-positives on scrape/grape — use segments + "rapist"
  "rapist",
  "molest",
  "pedophile",
  "paedophile",
  "pedoph",
  "paedoph",
  "childporn",
  "child-porn",
  "kike",
  "spic",
  "chink",
  "gook",
  "tranny",
  "troon",
  "wetback",
  "beaner",
  "dyke",
  "slut",
  "whore",
  "bastard",
  "bollocks",
  "wanker",
  "twat",
  "prick",
  "dickhead",
  "asshole",
  "arsehole",
  "jackass",
  "dumbass",
  "dipshit",
  "shithead",
  "pussy",
  "penis",
  "vagina",
  "blowjob",
  "handjob",
  "cumshot",
  "orgasm",
  "hentai",
  "onlyfans",
  "pornhub",
  "xxx",
  "porn",
  "nudes",
  "hitler",
  "kkk",
] as const;

/**
 * Short / ambiguous tokens — only rejected as whole hyphen segments
 * (so "scrape" / "raccoon" stay fine; "rape" / "coon" as their own segment do not).
 */
const BLOCKED_SEGMENTS = new Set([
  "ass",
  "arse",
  "dick",
  "cock",
  "tit",
  "tits",
  "sex",
  "sexy",
  "porn",
  "nude",
  "nazi",
  "kkk",
  "fag",
  "hoe",
  "jap",
  "coon",
  "spic",
  "kike",
  "gook",
  "rape",
  "raped",
  "slut",
  "whore",
  "piss",
  "cum",
  "anal",
  "anus",
  "boob",
  "boobs",
  "jizz",
]);

export type LocalPartValidation =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/** Light leetspeak fold for abuse checks only (claim value stays original). */
function foldForAbuseCheck(value: string): string {
  return value
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/\$/g, "s")
    .replace(/@/g, "a");
}

function containsBlockedAbuse(value: string): boolean {
  const folded = foldForAbuseCheck(value);
  const digitStripped = folded.replace(/[0-9]/g, "");
  const candidates = [folded, digitStripped];

  if (
    candidates.some((candidate) =>
      BLOCKED_SUBSTRINGS.some((bad) => candidate.includes(bad)),
    )
  ) {
    return true;
  }

  for (const candidate of candidates) {
    const segments = candidate.split("-").filter(Boolean);
    if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment))) return true;
    if (BLOCKED_SEGMENTS.has(candidate)) return true;
  }

  return false;
}

/**
 * Normalise + validate a requested local-part. Lowercases, enforces charset and
 * length, and rejects reserved / abusive names. Does NOT check availability (a
 * DB unique constraint is the authoritative check for that).
 */
export function validateLocalPart(input: string): LocalPartValidation {
  const value = input.trim().toLowerCase();

  if (value.length < 3) {
    return { ok: false, reason: "Address must be at least 3 characters." };
  }
  if (value.length > 40) {
    return { ok: false, reason: "Address must be 40 characters or fewer." };
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) {
    return {
      ok: false,
      reason: "Use lowercase letters, numbers, and hyphens (no leading/trailing hyphen).",
    };
  }
  if (value.includes("--")) {
    return { ok: false, reason: "Address cannot contain consecutive hyphens." };
  }
  if (RESERVED_LOCAL_PARTS.has(value)) {
    return { ok: false, reason: "That address is reserved. Choose another." };
  }
  // Brand: any local-part containing AdeHQ / NexCache, plus Maya exact/prefix.
  if (
    value.includes("adehq") ||
    value.includes("nexcache") ||
    value === "maya" ||
    value.startsWith("maya-") ||
    value.endsWith("-maya")
  ) {
    return { ok: false, reason: "That address is reserved. Choose another." };
  }
  if (containsBlockedAbuse(value)) {
    return { ok: false, reason: "That address isn't allowed. Choose another." };
  }

  return { ok: true, value };
}
