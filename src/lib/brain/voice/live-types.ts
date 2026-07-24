export type CallSttMode = "fast_turn" | "live_streaming";
export type SttAdapterMode = "batch_utterance" | "streaming";
export type TtsAdapterMode = "complete_audio" | "streaming_audio";

export type SpeechContext = {
  workspaceId: string;
  conversationId: string;
  humanUserId: string;
  employeeId: string;
  language?: string;
  region?: string;
  vocabularyPrompt?: string;
  signal?: AbortSignal;
};

export type UtteranceInput = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  durationSeconds: number;
};

export type FinalTranscript = {
  text: string;
  language?: string;
  confidence?: number;
  providerDurationSeconds?: number;
  actualAudioSeconds: number;
  billableAudioSeconds: number;
  latencyMs: number;
  routeId: LiveSttRouteId;
  raw?: unknown;
};

export type StreamingTranscriptEvent =
  | { type: "partial"; text: string }
  | { type: "final"; transcript: FinalTranscript };

export interface StreamingTranscriptionSession {
  append(frame: Uint8Array): Promise<void>;
  commit(): Promise<void>;
  close(): Promise<void>;
  events: AsyncIterable<StreamingTranscriptEvent>;
}

export type SpeechSynthesisInput = {
  text: string;
  voice?: string;
  locale?: string;
  speed?: number;
  format?: "mp3" | "wav" | "opus" | "pcm";
  signal?: AbortSignal;
};

export type SpeechAudioChunk = {
  sequence: number;
  bytes: Uint8Array;
  mimeType: string;
  sampleRate?: number;
  channels?: number;
};

export type SpeechSynthesisResult = {
  bytes: Buffer;
  mimeType: string;
  utf8Bytes: number;
  characters: number;
  latencyMs: number;
  routeId: LiveTtsRouteId;
};

export interface RealtimeTtsSession {
  appendText(text: string): Promise<void>;
  flush(): Promise<void>;
  interrupt(reason?: string): Promise<void>;
  close(): Promise<void>;
  chunks: AsyncIterable<SpeechAudioChunk>;
}

/** @deprecated Use RealtimeTtsSession. */
export interface StreamingSpeechSession {
  chunks: AsyncIterable<SpeechAudioChunk>;
  cancel(reason?: string): Promise<void>;
}

export interface SpeechToTextAdapter {
  mode: SttAdapterMode;
  transcribeUtterance(
    input: UtteranceInput,
    context: SpeechContext,
  ): Promise<FinalTranscript>;
  openStream?(context: SpeechContext): Promise<StreamingTranscriptionSession>;
}

export interface TextToSpeechAdapter {
  mode: TtsAdapterMode;
  synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult>;
  openRealtimeSession?(
    input: Omit<SpeechSynthesisInput, "text">,
  ): Promise<RealtimeTtsSession>;
  /** @deprecated Compatibility for callers that synthesize one text input. */
  openStream?(input: SpeechSynthesisInput): Promise<StreamingSpeechSession>;
}

export type LiveSttRouteId =
  | "route_call_stt_groq_turbo"
  | "route_call_stt_groq_accurate"
  | "route_stt_fast"
  | "route_call_stt_streaming";

export type LiveTtsRouteId =
  | "route_tts_cosyvoice2"
  | "route_call_tts_xai"
  | "route_call_tts_fish";

export type CallUsageOutcome =
  | "success"
  | "partial"
  | "failed_provider_billed"
  | "failed_unbilled"
  | "cancelled";

export type CallUsageSettlement = {
  estimatedWh: number;
  reservedWh: number;
  actualWh: number;
  customerChargedWh: number;
  outcome: CallUsageOutcome;
};

export type CallConversationType = "human_ai_dm" | "room" | "topic";
export type CallSessionState =
  | "connecting"
  | "active"
  | "reconnecting"
  | "ending"
  | "ended"
  | "failed";
export type CallTurnState =
  | "listening"
  | "transcribing"
  | "thinking"
  | "using_tools"
  | "synthesizing"
  | "speaking"
  | "interrupted"
  | "completed"
  | "failed";
export type EmployeeCallActivity =
  | "waiting"
  | "thinking"
  | "searching"
  | "using_tool"
  | "speaking";

export type LiveCallEntitlements = {
  enabled: boolean;
  maxConcurrentCallsPerWorkspace: number;
  maxConcurrentCallsPerHuman: number;
  maxCallDurationMinutes: number;
  maxIdleMinutes: number;
  maxTurnWh: number;
  premiumVoiceEnabled: boolean;
  recordingEnabled: boolean;
  transcriptRetentionDays: number | null;
};

export type ClientCallEvent =
  | { type: "audio.append"; pcm: string; sequence: number }
  | { type: "audio.commit"; durationSeconds: number; mimeType?: string }
  | { type: "interrupt" }
  | { type: "mute"; muted: boolean }
  | { type: "end_call" }
  | { type: "reconnect"; sessionToken: string };

export type ServerCallEvent =
  | { type: "session.ready"; callSessionId: string; sessionToken: string }
  | { type: "listening.activity"; level: number }
  | { type: "transcript.partial"; text: string; source: "streaming_stt" }
  | {
      type: "transcript.final";
      text: string;
      source: "groq" | "streaming_stt" | "fallback";
    }
  | { type: "employee.text.delta"; text: string }
  | { type: "employee.text.final"; text: string }
  | {
      type: "employee.audio.delta";
      audio: string;
      sequence: number;
      mimeType: string;
      sampleRate?: number;
      channels?: number;
    }
  | { type: "employee.audio.end" }
  | { type: "usage.estimate"; wh: number }
  | {
      type: "usage.settled";
      components: { sttWh: number; brainWh: number; ttsWh: number };
    }
  | {
      type: "state.changed";
      session?: CallSessionState;
      turn?: CallTurnState;
      activity?: EmployeeCallActivity;
    }
  | {
      type: "session.ended";
      reason: "work_hours_exhausted" | "call_ended";
      message: string;
    }
  | { type: "error"; code: string; message: string; recoverable: boolean };
