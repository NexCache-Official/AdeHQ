# Human and hybrid calls

AdeHQ human calls use one Cloudflare Realtime SFU path for launch. The browser owns
`RTCPeerConnection`; authenticated Next.js routes proxy Cloudflare session, track,
and renegotiation requests so the provider token never enters a client bundle.

## Boundaries

```text
Browser media → /api/calls/{callId}/media/* → Cloudflare Realtime SFU
Ringing/state → /api/calls/* + durable Postgres + Supabase Realtime hints
AI voice → existing Brain/TTS metering → published into the active SFU session
```

- `call_sessions` is the durable product envelope.
- `call_participants`, `call_invitations`, and expiring participant leases make
  busy state and multi-device acceptance authoritative.
- `call_media_sessions` stores provider summaries, never ICE packets or audio.
- `call_events` is append-only audit state.
- `call_consents`, `call_artifacts`, and `call_ai_turns` govern AI participation
  and connect live conversation to reusable work.
- Existing `calls` / `call_turns` remain the PR-18.1 Brain-call compatibility model.

## Privacy

Human-private calls have no AI, transcript, or recording by default. AI employees
must be invited with a visible participation mode; spoken AI turns require every
human participant to grant `ai_listening` consent. Human media does not consume Work
Hours. Brain/TTS work does.

Cloudflare SFU transport is encrypted WebRTC transport, but is not marketed as
participant-to-participant E2EE. Application-layer encoded-frame encryption remains
an enterprise investigation because server-side AI and strict E2EE are incompatible.

## Reliability

Clients persist a device ID, heartbeat a 45-second lease, recover after refresh,
poll durable call state as a fallback, subscribe to Realtime invitation changes,
and collect packet loss, jitter, and RTT through `RTCPeerConnection.getStats()`.
Web Push is best effort; iOS users are guided to install AdeHQ to the Home Screen.

- Notification health and a test push are exposed on the Calls surface.
- Quality, connection, reconnection, candidate type, and first-audio samples are
  appended to `call_events`; `/api/calls/metrics` returns a 30-day aggregate.
- Video senders lower bitrate when packet loss or RTT degrades. Device inputs can
  be replaced without leaving the call.
- Room/topic huddles remain on the SFU and enforce room access plus the workspace
  participant entitlement for every invitee.
- Release verification can require every Playwright engine with
  `CALL_BROWSER_REQUIRE_ALL=1 npm run test:calls:browsers`.

## Hybrid participation

Every human must grant AI-listening consent before an employee joins. Transcription
and recording have separate all-human consent checks and an explicit retention
choice.

- Silent observers turn consented transcript segments into owner-private notes.
- On-request is the default. Spoken turns are explicit, only one AI may speak at a
  time, and a human can interrupt playback.
- Advisor/facilitator/active modes use the same Steward gate; facilitator is the
  first spokesperson preference for an expert council.
- Private sidecars use `persistToRoom: false`, so the normal employee runtime is
  metered without publishing a room message or effects.
- Delegations run while human media continues. Council specialists remain private
  and one synthesized spokesperson result is shared.
- Summaries create call artifacts and materialize decisions/tasks into Work Graph
  edges; tasks also appear in the canonical Tasks surface.

### Group Call Steward foundation

`src/lib/calls/steward/` is the provider-independent policy boundary for group
participation. It resolves deterministic signals before any optional ambiguity
classifier: explicit employee mention, directed role, current owner/workstream,
requested group opinion, human-only context, and critical correction. Classifier
failure is fail-quiet. Product modes map onto the existing persisted values:
Quiet → `silent_observer`, Smart assist → `on_request`, Active → `active`, and
Council → `facilitator`.

The floor controller gives humans priority, permits one AI speaker, queues other
requests by priority, suppresses duplicate segment/employee requests, and
interrupts the AI immediately when a human starts speaking. Council work uses a
capped set of silent collaborators and exactly one lead synthesis. Collaborators
consume the shared call transcript; they do not create separate listening or STT
streams.

Speaker attribution prefers native WebRTC provider-session plus track identity.
Known multichannel inputs are used only up to the provider's declared channel
limit. Diarization is reserved for unknown, mixed external audio.

Call Steward metadata states the customer billing contract without writing a new
ledger: one call-minute stream per call, never multiplied by invited AI, and Work
Hours itemized only for AI employees that actually produced a specialist, lead,
or single-turn contribution.

## Optimization and enterprise privacy

Direct P2P is off by default and gated by `NEXT_PUBLIC_ADEHQ_P2P_CALLS_V1=1`.
Eligibility is limited to human-only, private, two-person, audio-only calls. A
failed direct connection automatically creates a new SFU media leg and records
`call.media_migrated`; adding AI, video, screen share, or a group participant also
selects the SFU. SDP and ICE remain ephemeral Supabase Broadcast messages; payloads
are AES-GCM encrypted with a per-call key derived server-side and released only
after durable participant authorization.

`force_relay` is entitlement checked by both the media and TURN routes. It fails
closed when Cloudflare TURN keys are absent and remains enabled when credentials
refresh. It hides direct peer addresses but does not make SFU calls end-to-end
encrypted.

Application-layer encoded-frame E2EE remains an investigation, not a shipped
claim. The current decision is:

- human-only calls may adopt encoded-frame encryption later;
- server-side transcription, recording, and AI participation require a decryptable
  media path and therefore cannot run in strict E2EE mode;
- product copy must say WebRTC transport encrypted, never participant-to-participant
  E2EE for the SFU path.

## Recording and retention

Team-entitled users can record a browser-composed work session only after every
human grants recording consent. Recordings are uploaded through the authenticated
call route to the private `call-recordings` bucket. No client storage policy exists;
downloads use five-minute signed URLs.

`session_only` recordings are removed when the call ends (with a one-day expiry
fallback), `30_days` expires after 30 days, and `workspace_default` currently maps
to 30 days until workspace policy is configurable. The recording owner or a
workspace admin can delete immediately. Recording metadata and an audit event are
durable; raw media never enters observability payloads.

## Configuration

```bash
ADEHQ_HUMAN_CALLS_V1=1
NEXT_PUBLIC_ADEHQ_HUMAN_CALLS_V1=1
CLOUDFLARE_REALTIME_APP_ID=
CLOUDFLARE_REALTIME_API_TOKEN=
CLOUDFLARE_TURN_KEY_ID=
CLOUDFLARE_TURN_API_TOKEN=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:support@adehq.com
CALL_SIGNALING_SECRET=
```

Provider and VAPID secrets are server-only. Rotate any token used during live
verification after the test.
