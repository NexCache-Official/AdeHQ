export type CallKind = "human_human" | "human_ai" | "group" | "hybrid";
export type CallStatus =
  | "ringing"
  | "connecting"
  | "active"
  | "reconnecting"
  | "declined"
  | "missed"
  | "cancelled"
  | "ended"
  | "failed";
export type CallPrivacyMode = "human_private" | "ai_assisted" | "recorded_work_session";
export type CallTopology = "p2p" | "sfu";
export type MediaBackend =
  | "cloudflare_sfu"
  | "cloudflare_realtimekit"
  | "custom_webrtc"
  | "brain_voice";
export type RelayPolicy = "automatic" | "force_relay";
export type AiParticipationMode =
  | "silent_observer"
  | "on_request"
  | "advisor"
  | "facilitator"
  | "active";

export type HumanCallEntitlements = {
  enabled: boolean;
  maxConcurrentCallsPerWorkspace: number;
  maxParticipants: number;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenShareEnabled: boolean;
  groupCallsEnabled: boolean;
  recordingEnabled: boolean;
  forceRelayAvailable: boolean;
  maxVideoQuality: "360p" | "720p" | "1080p";
};

export type CallSessionSummary = {
  id: string;
  workspaceId: string;
  roomId: string;
  kind: CallKind;
  status: CallStatus;
  privacyMode: CallPrivacyMode;
  title: string;
  createdBy: string | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenShareEnabled: boolean;
  participantLimit: number;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  liveCallMinutes: number;
  aiWorkHours: number;
  transcriptIncluded: boolean;
  captionsIncluded: boolean;
  createdAt: string;
  participants: CallParticipantSummary[];
  entitlements?: HumanCallEntitlements;
};

export type CallParticipantSummary = {
  id: string;
  participantType: "human" | "ai_employee";
  userId: string | null;
  employeeId: string | null;
  role: "host" | "participant" | "observer";
  participationMode: AiParticipationMode | null;
  state: string;
  deviceId: string | null;
  muteState: boolean;
  cameraState: boolean;
  providerSessionId: string | null;
  publishedTracks: CloudflareTrackDescriptor[];
};

export type CloudflareTrackDescriptor = {
  location: "local" | "remote";
  mid?: string;
  trackName: string;
  sessionId?: string;
};

export type CloudflareSessionDescription = {
  type: "offer" | "answer";
  sdp: string;
};

export type CallArtifactType =
  | "decision"
  | "task"
  | "question"
  | "risk"
  | "approval"
  | "artifact"
  | "memory"
  | "summary"
  | "note";
