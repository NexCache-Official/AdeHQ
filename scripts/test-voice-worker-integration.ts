import assert from "node:assert/strict";
import {
  createVoiceWorkerToken,
  verifyVoiceWorkerToken,
} from "../src/lib/brain/voice/worker-token";
import { resolveLiveCallsTransport } from "../src/lib/brain/voice/worker-transport";

process.env.ADEHQ_WORKER_TOKEN_SECRET = "integration-worker-secret-".repeat(2);

async function main() {
const token = createVoiceWorkerToken({
  userId: "user-1",
  workspaceId: "workspace-1",
  callId: "call-1",
});
const claims = verifyVoiceWorkerToken(token, ["brain:turn", "sfu:subscribe"]);
assert.equal(claims.sub, "user-1");
assert.equal(claims.workspaceId, "workspace-1");
assert.equal(claims.callId, "call-1");
assert.ok(claims.exp - claims.iat <= 300);
assert.throws(
  () => verifyVoiceWorkerToken(`${token}x`, ["brain:turn"]),
  /signature/,
);

assert.deepEqual(
  await resolveLiveCallsTransport({
    ADEHQ_LIVE_CALLS_TRANSPORT: "vercel_ws",
  }),
  { requested: "vercel_ws", selected: "vercel_ws" },
);

const missing = await resolveLiveCallsTransport({
  ADEHQ_LIVE_CALLS_TRANSPORT: "cloudflare_worker",
});
assert.equal(missing.selected, "vercel_ws");
assert.equal(missing.fallbackReason, "worker_configuration_missing");

const readyButNoClientBridge = await resolveLiveCallsTransport(
  {
    ADEHQ_LIVE_CALLS_TRANSPORT: "cloudflare_worker",
    ADEHQ_VOICE_WORKER_URL: "https://worker.example.test",
    ADEHQ_WORKER_TOKEN_SECRET: "integration-worker-secret-".repeat(2),
  },
  async () =>
    new Response(JSON.stringify({ ok: true, cutoverReady: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
);
assert.equal(readyButNoClientBridge.selected, "vercel_ws");
assert.equal(readyButNoClientBridge.fallbackReason, "client_sfu_bridge_not_ready");

console.log("Voice worker app integration contracts: PASS");
}

void main();
