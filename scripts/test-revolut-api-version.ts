/**
 * Ensures Revolut API version pin defaults to the locked contract version.
 */
import assert from "node:assert/strict";
import { getRevolutConfig } from "../src/lib/billing/revolut/client";

const prevMerchant = process.env.REVOLUT_MERCHANT_API_VERSION;
const prevApi = process.env.REVOLUT_API_VERSION;
const prevKey = process.env.REVOLUT_MERCHANT_API_KEY;

delete process.env.REVOLUT_MERCHANT_API_VERSION;
delete process.env.REVOLUT_API_VERSION;
process.env.REVOLUT_MERCHANT_API_KEY = "test_key";

const config = getRevolutConfig();
assert.ok(config);
assert.equal(config!.apiVersion, "2026-04-20");
console.log("ok — default Revolut API version is 2026-04-20");

process.env.REVOLUT_MERCHANT_API_VERSION = "2025-10-16";
const config2 = getRevolutConfig();
assert.equal(config2!.apiVersion, "2025-10-16");
console.log("ok — REVOLUT_MERCHANT_API_VERSION override works");

if (prevMerchant === undefined) delete process.env.REVOLUT_MERCHANT_API_VERSION;
else process.env.REVOLUT_MERCHANT_API_VERSION = prevMerchant;
if (prevApi === undefined) delete process.env.REVOLUT_API_VERSION;
else process.env.REVOLUT_API_VERSION = prevApi;
if (prevKey === undefined) delete process.env.REVOLUT_MERCHANT_API_KEY;
else process.env.REVOLUT_MERCHANT_API_KEY = prevKey;

console.log("\nAll Revolut API version tests passed.");
