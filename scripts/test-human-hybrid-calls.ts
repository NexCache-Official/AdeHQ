import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function main() {
  const root = resolve(process.cwd());
  const migration = await readFile(
    resolve(root, "supabase/migrations/20260721160000_human_hybrid_calls.sql"),
    "utf8",
  );
  const cloudflare = await readFile(resolve(root, "src/lib/calls/cloudflare.ts"), "utf8");
  const clientHook = await readFile(resolve(root, "src/hooks/useHumanSfuCall.ts"), "utf8");
  const incoming = await readFile(
    resolve(root, "src/components/calls/IncomingCallProvider.tsx"),
    "utf8",
  );
  const turnRoute = await readFile(
    resolve(root, "src/app/api/calls/turn-credentials/route.ts"),
    "utf8",
  );
  const aiTurn = await readFile(
    resolve(root, "src/app/api/calls/[callId]/ai/turn/route.ts"),
    "utf8",
  );
  const huddles = await readFile(
    resolve(root, "src/app/api/calls/huddles/route.ts"),
    "utf8",
  );
  const transcription = await readFile(
    resolve(root, "src/app/api/calls/[callId]/transcribe/route.ts"),
    "utf8",
  );
  const summary = await readFile(
    resolve(root, "src/app/api/calls/[callId]/ai/summary/route.ts"),
    "utf8",
  );
  const council = await readFile(
    resolve(root, "src/app/api/calls/[callId]/ai/council/route.ts"),
    "utf8",
  );
  const mediaSelector = await readFile(
    resolve(root, "src/hooks/useHumanCallMedia.ts"),
    "utf8",
  );
  const p2pRoute = await readFile(
    resolve(root, "src/app/api/calls/[callId]/media/p2p/route.ts"),
    "utf8",
  );
  const p2pHook = await readFile(
    resolve(root, "src/hooks/useDirectP2PCall.ts"),
    "utf8",
  );
  const recordings = await readFile(
    resolve(root, "src/app/api/calls/[callId]/recordings/route.ts"),
    "utf8",
  );
  const telemetry = await readFile(
    resolve(root, "src/app/api/calls/[callId]/telemetry/route.ts"),
    "utf8",
  );

  for (const table of [
    "call_sessions",
    "call_participants",
    "call_invitations",
    "call_participant_leases",
    "call_media_sessions",
    "call_events",
    "call_consents",
    "call_artifacts",
    "call_ai_turns",
    "push_subscriptions",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }

  assert.match(migration, /accept_call_invitation/);
  assert.match(migration, /for update/);
  assert.match(migration, /grant execute .* service_role/);
  assert.match(migration, /revoke insert, update, delete .* authenticated/);
  assert.match(cloudflare, /CLOUDFLARE_REALTIME_API_TOKEN/);
  assert.doesNotMatch(clientHook, /CLOUDFLARE_REALTIME_API_TOKEN/);
  assert.match(turnRoute, /stun:stun\.cloudflare\.com:3478/);
  assert.match(clientHook, /getStats\(\)/);
  assert.match(clientHook, /webrtc-adapter/);
  assert.match(incoming, /serviceWorker\.register\("\/call-sw\.js"\)/);
  assert.match(incoming, /call_invitations/);
  assert.match(aiTurn, /call_consents/);
  assert.match(aiTurn, /executeTextToSpeech/);
  assert.match(aiTurn, /call_ai_turns/);
  assert.match(aiTurn, /persistToRoom: !parsed\.data\.privateSidecar/);
  assert.match(huddles, /maxParticipants/);
  assert.match(huddles, /assertCanAccessRoom/);
  assert.match(transcription, /silent_observer/);
  assert.match(transcription, /Every human participant must consent/);
  assert.match(summary, /createCallArtifact/);
  assert.match(summary, /Call summary/);
  assert.match(council, /single spokesperson/);
  assert.match(council, /facilitator_then_on_request/);
  assert.match(mediaSelector, /NEXT_PUBLIC_ADEHQ_P2P_CALLS_V1/);
  assert.match(mediaSelector, /p2p\.phase === "failed"/);
  assert.match(p2pRoute, /topology: "p2p"/);
  assert.match(p2pHook, /AES-GCM/);
  assert.match(p2pHook, /media\/signal-key/);
  assert.match(recordings, /Every human participant must consent before recording/);
  assert.match(recordings, /createSignedUrl/);
  assert.match(telemetry, /call\.telemetry/);

  console.log("human/hybrid calls invariants: ok");
}

void main();
