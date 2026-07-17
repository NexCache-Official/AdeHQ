/** PR-18 — Voice / audio contracts (member-facing labels, never model SKUs). */

export type TtsIntent = "read_aloud" | "narration" | "premium_voiceover";
export type SttIntent = "voice_note" | "accurate" | "meeting";

export type TtsRouteId =
  | "route_tts_cosyvoice2"
  | "route_tts_indextts2"
  | "route_tts_fish_speech";

export type SttRouteId =
  | "route_stt_fast"
  | "route_stt_accurate"
  | "route_stt_diarized";

export const TTS_INTENT_LABEL: Record<TtsIntent, string> = {
  read_aloud: "Listen",
  narration: "Generate narration",
  premium_voiceover: "Create premium voiceover",
};

export const STT_INTENT_LABEL: Record<SttIntent, string> = {
  voice_note: "Transcribe voice note",
  accurate: "Accurate transcription",
  meeting: "Meeting transcription",
};

export type EmployeeVoiceProfile = {
  voiceEnabled: boolean;
  voiceStyle: "professional" | "warm" | "energetic" | "calm";
  locale?: string;
  speakingRate?: number;
  premiumVoiceAllowed: boolean;
};

export type WorkspaceVoiceSettings = {
  voiceEnabled: boolean;
  premiumVoicesAllowed: boolean;
  maxAudioSeconds: number;
  retentionDays: number;
  meetingTranscriptionAllowed: boolean;
  diarizationAllowed: boolean;
};

export type SpeechToTextSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string;
};

export type SpeechToTextResult = {
  transcript: string;
  language?: string;
  confidence?: number;
  durationSeconds: number;
  segments: SpeechToTextSegment[];
  routeId: SttRouteId;
  memberLabel: string;
  estimatedWh: number;
  costUsd: number;
  latencyMs: number;
};

export type TextToSpeechResult = {
  bytes: Buffer;
  mimeType: string;
  durationEstimateSeconds?: number;
  utf8Bytes: number;
  routeId: TtsRouteId;
  memberLabel: string;
  estimatedWh: number;
  costUsd: number;
  latencyMs: number;
};

export type VoicePolicyDecision = {
  action: "proceed" | "confirm_estimate" | "blocked";
  estimatedWhMin: number;
  estimatedWhMax: number;
  memberLabel: string;
  remainingWh: number | null;
  reason?: string;
};

export type TranscribeRequest = {
  intent: SttIntent;
  /** Uploaded workspace file id or private audio object path. */
  audioFileId?: string;
  audioStoragePath?: string;
  audioBytes?: Buffer;
  mimeType?: string;
  fileName?: string;
  durationSecondsHint?: number;
  requireDiarization?: boolean;
  confirmed?: boolean;
};

export type SynthesizeRequest = {
  intent: TtsIntent;
  text: string;
  voiceStyle?: EmployeeVoiceProfile["voiceStyle"];
  locale?: string;
  speakingRate?: number;
  confirmed?: boolean;
};
