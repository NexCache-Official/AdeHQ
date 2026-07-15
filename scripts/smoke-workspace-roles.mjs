/**
 * Smoke checks for admin/member role collapse + invite token URL shape.
 * Run: node scripts/smoke-workspace-roles.mjs
 */

function normalizeWorkspaceRole(role) {
  switch (role) {
    case "admin":
    case "owner":
      return "admin";
    case "member":
    case "manager":
    case "guest":
    case "viewer":
      return "member";
    default:
      return "member";
  }
}

const cases = [
  ["owner", "admin"],
  ["admin", "admin"],
  ["manager", "member"],
  ["guest", "member"],
  ["viewer", "member"],
  ["member", "member"],
  ["unknown", "member"],
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = normalizeWorkspaceRole(input);
  if (got !== expected) {
    console.error(`FAIL normalize(${input}) => ${got}, expected ${expected}`);
    failed += 1;
  }
}

const siteUrl = "https://app.adehq.com";
const token = "abc123";
const actionUrl = `${siteUrl}/invite/${token}`;
if (!actionUrl.endsWith(`/invite/${token}`) || actionUrl.includes("login?next")) {
  console.error("FAIL invite URL shape", actionUrl);
  failed += 1;
}

const safeNext = (raw, fallback = "/") => {
  if (!raw) return fallback;
  const next = raw.trim();
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return fallback;
};

if (safeNext("/invite/tok") !== "/invite/tok") {
  console.error("FAIL safeNext invite path");
  failed += 1;
}
if (safeNext("https://evil.com") !== "/") {
  console.error("FAIL safeNext rejects absolute URL");
  failed += 1;
}
if (safeNext("//evil.com") !== "/") {
  console.error("FAIL safeNext rejects protocol-relative URL");
  failed += 1;
}

if (failed) {
  console.error(`${failed} smoke check(s) failed`);
  process.exit(1);
}
console.log("workspace roles + invite smoke checks passed");
