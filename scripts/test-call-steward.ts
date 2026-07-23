import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildAttributionPlan,
  createCallBillingMetadata,
  createFloorState,
  decideParticipation,
  humanStartedSpeaking,
  humanStoppedSpeaking,
  planCouncil,
  releaseAiFloor,
  requestAiFloor,
  resolveSpeakerAttribution,
  toPersistedParticipationMode,
} from "../src/lib/calls/steward";

async function testParticipation() {
  let classifierCalls = 0;
  const classifier = {
    async classify() {
      classifierCalls += 1;
      return "participate" as const;
    },
  };
  const base = {
    utterance: "Can product weigh in?",
    mode: "smart_assist" as const,
    candidate: {
      employeeId: "emp_product",
      role: "Product",
      workstreams: ["Launch"],
    },
    classifier,
  };

  assert.equal(
    (await decideParticipation({
      ...base,
      explicitMentionedEmployeeIds: ["emp_product"],
    })).reason,
    "explicit_mention",
  );
  assert.equal(classifierCalls, 0);
  assert.equal(
    (await decideParticipation({ ...base, directedRole: "product" })).reason,
    "role_directed",
  );
  assert.equal(
    (await decideParticipation({ ...base, currentWorkstream: "launch" })).reason,
    "current_owner",
  );
  assert.equal(
    (await decideParticipation({ ...base, criticalCorrection: true })).priority,
    95,
  );
  assert.deepEqual(
    await decideParticipation({ ...base, humanOnly: true }),
    {
      participate: false,
      action: "abstain",
      reason: "human_only",
      deterministic: true,
      priority: 0,
    },
  );
  const ambiguous = await decideParticipation(base);
  assert.equal(ambiguous.reason, "ambiguous_classifier");
  assert.equal(ambiguous.deterministic, false);
  assert.equal(classifierCalls, 1);
  assert.equal(
    (await decideParticipation({
      ...base,
      mode: "quiet",
      requestedGroupOpinion: true,
    })).reason,
    "mode_quiet",
  );
  assert.equal(toPersistedParticipationMode("quiet"), "silent_observer");
  assert.equal(toPersistedParticipationMode("smart_assist"), "on_request");
  assert.equal(toPersistedParticipationMode("council"), "facilitator");
}

function testAttribution() {
  const knownTracks = [
    {
      participantId: "human_1",
      providerSessionId: "session_1",
      trackName: "microphone",
      channel: 0,
    },
  ];
  assert.equal(
    resolveSpeakerAttribution({
      providerSessionId: "session_1",
      trackName: "microphone",
      knownTracks,
    }).method,
    "native_track_identity",
  );
  assert.equal(
    resolveSpeakerAttribution({
      channel: 0,
      knownTracks,
      providerLimits: { maxInputChannels: 2 },
    }).method,
    "multichannel",
  );
  assert.equal(
    resolveSpeakerAttribution({
      mixedExternalAudio: true,
      knownTracks: [],
    }).method,
    "diarization",
  );
  assert.deepEqual(
    buildAttributionPlan({
      tracks: knownTracks,
      providerMaxInputChannels: 2,
    }),
    {
      sharedSttStreamCount: 1,
      perAiListeningStreams: 0,
      nativeTrackCount: 1,
      multichannelTrackCount: 1,
      requiresDiarization: false,
    },
  );
}

function testFloor() {
  let state = createFloorState();
  let result = requestAiFloor(state, {
    turnId: "turn_1",
    employeeId: "ai_1",
    priority: 50,
    requestedAt: 1,
    dedupeKey: "segment_1:ai_1",
  });
  assert.equal(result.disposition, "granted");
  state = result.state;

  result = requestAiFloor(state, {
    turnId: "turn_duplicate",
    employeeId: "ai_1",
    priority: 100,
    requestedAt: 2,
    dedupeKey: "segment_1:ai_1",
  });
  assert.equal(result.disposition, "duplicate");

  result = requestAiFloor(result.state, {
    turnId: "turn_2",
    employeeId: "ai_2",
    priority: 80,
    requestedAt: 3,
    dedupeKey: "segment_2:ai_2",
  });
  assert.equal(result.disposition, "queued");
  result = humanStartedSpeaking(result.state, "human_1");
  assert.equal(result.disposition, "interrupted");
  assert.equal(result.interruptedTurnId, "turn_1");
  result = humanStoppedSpeaking(result.state, "human_1", 4);
  assert.equal(result.grantedTurnId, "turn_2");
  result = releaseAiFloor(result.state, "turn_2", 5);
  assert.equal(result.disposition, "released");
}

function testCouncilAndBilling() {
  const council = planCouncil(
    [
      { employeeId: "advisor", participationMode: "advisor" },
      { employeeId: "lead", participationMode: "facilitator" },
      { employeeId: "active", participationMode: "active" },
      { employeeId: "quiet", participationMode: "silent_observer" },
    ],
    { maxSilentCollaborators: 2 },
  );
  assert.equal(council.leadEmployeeId, "lead");
  assert.equal(council.collaboratorEmployeeIds.length, 2);
  assert.equal(council.omittedEmployeeIds.length, 1);
  assert.equal(council.sharedListening.perAiListeningStreams, 0);

  const billing = createCallBillingMetadata([
    { employeeId: "lead", workHours: 0.2, contribution: "lead_synthesis" },
    { employeeId: "advisor", workHours: 0.1, contribution: "specialist" },
  ]);
  assert.equal(billing.callMinutes.streamCount, 1);
  assert.equal(billing.callMinutes.multipliedByInvitedAi, false);
  assert.equal(billing.workHours.total, 0.30000000000000004);
  assert.equal(billing.workHours.contributions.length, 2);
}

async function testApiIntegration() {
  const root = resolve(process.cwd());
  const [turn, council, tracks, transcription] = await Promise.all([
    readFile(resolve(root, "src/app/api/calls/[callId]/ai/turn/route.ts"), "utf8"),
    readFile(resolve(root, "src/app/api/calls/[callId]/ai/council/route.ts"), "utf8"),
    readFile(resolve(root, "src/app/api/calls/[callId]/media/tracks/route.ts"), "utf8"),
    readFile(resolve(root, "src/app/api/calls/[callId]/transcribe/route.ts"), "utf8"),
  ]);
  assert.match(turn, /decideParticipation/);
  assert.match(turn, /createCallBillingMetadata/);
  assert.match(council, /planCouncil/);
  assert.match(council, /silent_collaborator/);
  assert.match(tracks, /resolveSpeakerAttribution/);
  assert.match(transcription, /perAiListeningStreams: 0/);
}

async function main() {
  await testParticipation();
  testAttribution();
  testFloor();
  testCouncilAndBilling();
  await testApiIntegration();
  console.log("call steward foundation: ok");
}

void main();
