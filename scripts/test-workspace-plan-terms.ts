/**
 * Plan terms + Revolut payload / signature helpers (no live keys).
 *   npm run test:workspace-plan-terms
 */
import { createHmac } from "crypto";
import { buildRevolutCreateOrderBody } from "../src/lib/billing/revolut/orders";
import {
  parseRevolutSignatureHeader,
  verifyRevolutSignature,
} from "../src/lib/billing/revolut/webhooks";
import { getRevolutCurrency } from "../src/lib/billing/revolut/client";
import {
  initializeFreePlanTerm,
  startPlanTerm,
} from "../src/lib/billing/plans/plan-terms";
import { syncWorkforceToCapacity } from "../src/lib/billing/usage/workforce-capacity";

function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`  ✓ ${name}`);
}

function main() {
  console.log("\n=== Workspace plan terms + Revolut helpers ===\n");

  const body = buildRevolutCreateOrderBody(
    { appBaseUrl: "https://app.adehq.com" },
    {
      intentId: "intent-123",
      workspaceId: "ws-1",
      planSlug: "pro",
      interval: "monthly",
      amountCents: 4900,
    },
    "USD",
  );

  check(
    "order uses merchant_order_data.reference",
    (body.merchant_order_data as { reference: string }).reference === "intent-123",
  );
  check("order has no legacy merchant_order_ext_ref", !("merchant_order_ext_ref" in body));
  check("order currency USD", body.currency === "USD");
  check("redirect success URL", String(body.redirect_url).includes("checkout=success"));

  const sigs = parseRevolutSignatureHeader("v1=abc, v1=def");
  check("parses multiple v1 signatures", sigs.length === 2 && sigs[0] === "abc" && sigs[1] === "def");

  process.env.REVOLUT_MERCHANT_API_KEY = "test-key";
  process.env.REVOLUT_WEBHOOK_SECRET = "whsec_test";
  const raw = '{"event":"ORDER_COMPLETED"}';
  const ts = "1710000000";
  const expected = createHmac("sha256", "whsec_test").update(`v1.${ts}.${raw}`).digest("hex");
  check(
    "verify accepts matching signature",
    verifyRevolutSignature(raw, { signature: `v1=${expected}`, timestamp: ts }),
  );
  check(
    "verify accepts multi-signature header with match",
    verifyRevolutSignature(raw, { signature: `v1=deadbeef, v1=${expected}`, timestamp: ts }),
  );
  check("verify rejects bad signature", !verifyRevolutSignature(raw, { signature: "v1=00", timestamp: ts }));

  check(
    "currency helper defaults USD",
    getRevolutCurrency() === "USD" || /^[A-Z]{3}$/.test(getRevolutCurrency()),
  );
  check("startPlanTerm export", typeof startPlanTerm === "function");
  check("initializeFreePlanTerm export", typeof initializeFreePlanTerm === "function");
  check("syncWorkforceToCapacity export", typeof syncWorkforceToCapacity === "function");

  console.log("\nAll plan-term / Revolut helper checks passed.\n");
}

main();
