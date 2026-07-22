import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const explicitFile = process.env.E2E_ENV_FILE;
  const file = resolve(process.cwd(), explicitFile || ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index);
    if (!explicitFile && process.env[key] !== undefined) continue;
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnv();
const base = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !anonKey || !secret) {
  throw new Error("Supabase environment is required.");
}

const service = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: staleUsers } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
for (const stale of staleUsers?.users ?? []) {
  if (stale.email?.startsWith("call-e2e-") && stale.email.endsWith("@example.com")) {
    await service.auth.admin.deleteUser(stale.id);
  }
}

async function api(path, token, workspaceId, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-adehq-workspace-id": workspaceId,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function memberToken(userId) {
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();
  if (profileError) throw profileError;
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
  });
  if (linkError) throw linkError;
  const { data, error } = await anon.auth.verifyOtp({
    email: profile.email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (error || !data.session) throw error || new Error("Member session unavailable.");
  return data.session.access_token;
}

const { data: allMemberships, error: membershipError } = await service
  .from("workspace_members")
  .select("workspace_id, user_id, role, status");
if (membershipError) throw membershipError;
const usableMemberships = (allMemberships ?? []).filter(
  (membership) => membership.status !== "removed",
);

let fixture;
let temporaryPeerId = null;
for (const membership of usableMemberships) {
  const peers = usableMemberships.filter(
    (candidate) =>
      candidate.workspace_id === membership.workspace_id &&
      candidate.user_id !== membership.user_id,
  );
  if (peers[0]) {
    fixture = {
      workspaceId: membership.workspace_id,
      adminId: membership.user_id,
      peerId: peers[0].user_id,
    };
    break;
  }
}
if (!fixture && usableMemberships[0]) {
  const seed = usableMemberships[0];
  const email = `call-e2e-${Date.now()}@example.com`;
  const { data: createdUser, error: userError } = await service.auth.admin.createUser({
    email,
    password: `CallE2E-${crypto.randomUUID()}!`,
    email_confirm: true,
  });
  if (userError || !createdUser.user) throw userError || new Error("Could not create E2E peer.");
  temporaryPeerId = createdUser.user.id;
  const { error: profileError } = await service.from("profiles").upsert({
    id: temporaryPeerId,
    name: "Call E2E Peer",
    email,
    role: "Member",
  });
  if (profileError) throw profileError;
  const { error: memberError } = await service.from("workspace_members").insert({
    workspace_id: seed.workspace_id,
    user_id: temporaryPeerId,
    role: "member",
    status: "active",
  });
  if (memberError) throw memberError;
  fixture = {
    workspaceId: seed.workspace_id,
    adminId: seed.user_id,
    peerId: temporaryPeerId,
  };
}
if (!fixture) throw new Error("No workspace membership was found for E2E.");
const adminId = fixture.adminId;
const adminToken = await memberToken(adminId);
const peerToken = await memberToken(fixture.peerId);

const dm = await api("/api/rooms/dm", adminToken, fixture.workspaceId, {
  method: "POST",
  body: JSON.stringify({ workspaceId: fixture.workspaceId, peerUserId: fixture.peerId }),
});
if (!dm.response.ok) throw new Error(`Human DM failed (${dm.response.status}).`);
const roomId = dm.body.roomId;
const idempotencyKey = `calls-e2e:${Date.now()}`;
const created = await api("/api/calls", adminToken, fixture.workspaceId, {
  method: "POST",
  body: JSON.stringify({
    roomId,
    peerUserId: fixture.peerId,
    idempotencyKey,
    video: false,
  }),
});
if (created.response.status !== 201) {
  throw new Error(`Call create failed (${created.response.status}): ${created.body.error || ""}`);
}
const callId = created.body.id;
const invitationId = created.body.invitationId;

const replay = await api("/api/calls", adminToken, fixture.workspaceId, {
  method: "POST",
  body: JSON.stringify({ roomId, peerUserId: fixture.peerId, idempotencyKey, video: false }),
});
if (!replay.response.ok || replay.body.id !== callId) throw new Error("Idempotent replay failed.");

const pending = await api("/api/calls/invitations", peerToken, fixture.workspaceId);
if (!pending.body.invitations?.some((invitation) => invitation.id === invitationId)) {
  throw new Error("Invitee did not receive the pending call.");
}
const accepted = await api("/api/calls/invitations", peerToken, fixture.workspaceId, {
  method: "POST",
  body: JSON.stringify({ invitationId, action: "accept", deviceId: "e2e-device-a" }),
});
if (!accepted.response.ok || !accepted.body.won) throw new Error("First device did not win.");
const second = await api("/api/calls/invitations", peerToken, fixture.workspaceId, {
  method: "POST",
  body: JSON.stringify({ invitationId, action: "accept", deviceId: "e2e-device-b" }),
});
if (!second.response.ok || second.body.won !== false || second.body.status !== "accepted") {
  throw new Error("Second device was not answered-elsewhere.");
}
const heartbeat = await api("/api/calls", adminToken, fixture.workspaceId, {
  method: "PATCH",
  body: JSON.stringify({
    callId,
    action: "heartbeat",
    deviceId: "e2e-host-device",
  }),
});
if (!heartbeat.response.ok || !heartbeat.body.leaseExpiresAt) {
  throw new Error("Host lease heartbeat failed.");
}
const consentA = await api(
  `/api/calls/${callId}/consents`,
  adminToken,
  fixture.workspaceId,
  {
    method: "POST",
    body: JSON.stringify({ consentType: "ai_listening", granted: true }),
  },
);
const consentB = await api(
  `/api/calls/${callId}/consents`,
  peerToken,
  fixture.workspaceId,
  {
    method: "POST",
    body: JSON.stringify({ consentType: "ai_listening", granted: true }),
  },
);
if (!consentA.response.ok || !consentB.response.ok) throw new Error("Consent persistence failed.");
const artifact = await api(`/api/calls/${callId}/artifacts`, adminToken, fixture.workspaceId, {
  method: "POST",
  body: JSON.stringify({ type: "decision", title: "E2E call decision", content: "Verified" }),
});
if (artifact.response.status !== 201) throw new Error("Call artifact creation failed.");
const ended = await api("/api/calls", adminToken, fixture.workspaceId, {
  method: "PATCH",
  body: JSON.stringify({ callId, action: "ended", deviceId: "e2e-host-device" }),
});
if (!ended.response.ok || ended.body.status !== "ended") throw new Error("Call end failed.");
const { count: leases } = await service
  .from("call_participant_leases")
  .select("user_id", { count: "exact", head: true })
  .eq("workspace_id", fixture.workspaceId)
  .eq("call_id", callId);
if ((leases ?? 0) !== 0) throw new Error("Call leases were not cleaned up.");

await service
  .from("call_sessions")
  .delete()
  .eq("workspace_id", fixture.workspaceId)
  .eq("id", callId);
if (temporaryPeerId) {
  await service
    .from("rooms")
    .delete()
    .eq("workspace_id", fixture.workspaceId)
    .eq("id", roomId);
  await service.auth.admin.deleteUser(temporaryPeerId);
}

console.log(
  JSON.stringify({
    create: true,
    idempotency: true,
    invitation: true,
    multiDeviceAccept: true,
    leases: true,
    consent: true,
    workArtifact: true,
    cleanup: true,
  }),
);
