export type AudioEncoding = "pcm_s16le" | "opus" | "mulaw" | "mp3";

export interface AudioFormat {
  encoding: AudioEncoding;
  sampleRateHz: number;
  channels: 1 | 2;
}

export interface FrameBase {
  sequence: number;
  timestampMs: number;
  traceId: string;
}

export interface AudioFrame extends FrameBase {
  type: "audio";
  direction: "input" | "output";
  format: AudioFormat;
  data: Uint8Array;
}

export interface TranscriptFrame extends FrameBase {
  type: "transcript";
  text: string;
  isFinal: boolean;
  confidence?: number;
  language?: string;
}

export interface TurnFrame extends FrameBase {
  type: "turn";
  event: "speech_started" | "speech_stopped" | "turn_ready" | "timeout";
  reason: "vad" | "semantic" | "timeout";
}

export interface ControlFrame extends FrameBase {
  type: "control";
  event: "interrupt" | "cancel" | "flush" | "end";
  targetTurnId?: string;
  reason?: string;
}

export interface ErrorFrame extends FrameBase {
  type: "error";
  source: string;
  message: string;
  recoverable: boolean;
}

export type VoiceFrame =
  | AudioFrame
  | TranscriptFrame
  | TurnFrame
  | ControlFrame
  | ErrorFrame;

export interface SpeechToTextRequest {
  audio: AsyncIterable<AudioFrame>;
  language?: string;
  signal: AbortSignal;
  metadata?: Readonly<Record<string, string>>;
}

export interface TextToSpeechRequest {
  text: string;
  voice?: string;
  outputFormat: AudioFormat;
  signal: AbortSignal;
  metadata?: Readonly<Record<string, string>>;
}

export interface VoiceInferenceProvider {
  readonly id: string;
  readonly capabilities: {
    streamingStt: boolean;
    streamingTts: boolean;
  };
  streamTranscription(request: SpeechToTextRequest): AsyncIterable<TranscriptFrame>;
  streamSpeech(request: TextToSpeechRequest): AsyncIterable<AudioFrame>;
}
