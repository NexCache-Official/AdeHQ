"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Mic, Square, X } from "lucide-react";
import { authHeaders } from "@/lib/api/auth-client";
import { cn } from "@/lib/utils";

type VoiceNoteButtonProps = {
  workspaceId: string;
  roomId?: string;
  topicId?: string;
  disabled?: boolean;
  /** Called with editable transcript after successful STT. */
  onTranscript: (transcript: string, meta: { estimatedWh: number; durationSeconds: number }) => void;
  className?: string;
};

// Minimal shape of the (non-standard, vendor-prefixed) Web Speech API — used
// only for a best-effort live caption while recording. Not all browsers
// implement it (notably Firefox); the authoritative transcript always comes
// from the server-side STT pipeline once recording stops, so this is purely
// a "you're being heard" UX affordance, never the value actually sent.
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: unknown) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Best-effort mimeType the STT provider will actually accept — see adapter.ts bareMimeType. */
function pickRecorderMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

/**
 * Microphone control for Rooms/DMs: record → transcribe → editable insert.
 * No auto-send; user must review the transcript. Shows a best-effort live
 * caption while recording (where the browser supports it) plus explicit
 * "Recording / Transcribing / Added" status so the control never looks idle
 * or stuck mid-flow.
 */
export function VoiceNoteButton({
  workspaceId,
  roomId,
  topicId,
  disabled,
  onTranscript,
  className,
}: VoiceNoteButtonProps) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [liveCaption, setLiveCaption] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopLiveCaption = useCallback(() => {
    try {
      speechRef.current?.stop();
    } catch {
      // best-effort only
    }
    speechRef.current = null;
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
      stopLiveCaption();
      mediaRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [stopLiveCaption],
  );

  const startLiveCaption = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    try {
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
      recognition.onresult = (event) => {
        const results = (event as { results: ArrayLike<{ 0: { transcript: string } }> }).results;
        let text = "";
        for (let i = 0; i < results.length; i += 1) {
          text += results[i][0].transcript;
        }
        setLiveCaption(text.trim());
      };
      recognition.onerror = () => {
        // Live captions are best-effort — a permission/network error here
        // must never affect the authoritative server transcription flow.
      };
      recognition.onend = () => {
        speechRef.current = null;
      };
      recognition.start();
      speechRef.current = recognition;
    } catch {
      speechRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRef.current;
    stopLiveCaption();
    if (!recorder || recorder.state === "inactive") {
      setRecording(false);
      clearTimer();
      return;
    }
    recorder.stop();
    setRecording(false);
    clearTimer();
  }, [stopLiveCaption]);

  const startRecording = useCallback(async () => {
    setError(null);
    setDone(false);
    setLiveCaption("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const actualMimeType = recorder.mimeType || mimeType || "audio/webm";
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: actualMimeType });
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - startedAtRef.current) / 1000),
        );
        setProcessing(true);
        try {
          const form = new FormData();
          form.append("file", blob, "voice-note.webm");
          form.append("intent", "voice_note");
          form.append("durationSeconds", String(durationSeconds));
          form.append("confirmed", "1");
          if (roomId) form.append("roomId", roomId);
          if (topicId) form.append("topicId", topicId);

          const headers = await authHeaders(workspaceId);
          // FormData sets its own content-type boundary — drop JSON content-type
          const { "Content-Type": _ct, ...rest } = headers as Record<string, string>;
          void _ct;
          const res = await fetch("/api/voice/transcribe", {
            method: "POST",
            headers: rest,
            body: form,
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error ?? "Transcription failed");
          }
          if (data.asyncJob) {
            setError("Recording is long — meeting transcription was started instead.");
            return;
          }
          const transcript = String(data.transcript ?? "").trim();
          if (!transcript) {
            setError("Didn't catch that — no speech was detected. Try again?");
            return;
          }
          onTranscript(transcript, {
            estimatedWh: Number(data.estimatedWh ?? 0),
            durationSeconds: Number(data.durationSeconds ?? durationSeconds),
          });
          setDone(true);
          doneTimerRef.current = setTimeout(() => setDone(false), 2200);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Transcription failed");
        } finally {
          setProcessing(false);
          setElapsedSec(0);
          setLiveCaption("");
        }
      };
      mediaRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      recorder.start(250);
      setRecording(true);
      startLiveCaption();
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.round((Date.now() - startedAtRef.current) / 1000));
      }, 250);
    } catch {
      setError("Microphone permission is required for voice notes.");
    }
  }, [workspaceId, roomId, topicId, onTranscript, startLiveCaption]);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled || processing}
        onClick={() => (recording ? stopRecording() : void startRecording())}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-ink-2 hover:bg-surface-2 disabled:opacity-50",
          recording && "border-rose-300 bg-rose-50 text-rose-700",
          done && "border-emerald-300 bg-emerald-50 text-emerald-700",
        )}
        aria-label={recording ? "Stop recording" : "Record voice note"}
        title={recording ? "Stop recording" : "Voice note"}
      >
        {processing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : done ? (
          <Check className="h-4 w-4" />
        ) : recording ? (
          <Square className="h-3.5 w-3.5 fill-current" />
        ) : (
          <Mic className="h-4 w-4" strokeWidth={1.8} />
        )}
      </button>
      {recording ? (
        <div className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-lg border border-rose-200 bg-surface-1 p-2 text-[11px] shadow-sm">
          <div className="flex items-center gap-1.5 font-medium text-rose-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-600" />
            </span>
            Recording · {elapsedSec}s · tap to stop
          </div>
          <p className="mt-1 line-clamp-3 text-ink-3">
            {liveCaption || "Listening…"}
          </p>
        </div>
      ) : processing ? (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-ink-3">
          Transcribing…
        </span>
      ) : done ? (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-emerald-700">
          Added to message
        </span>
      ) : null}
      {error ? (
        <div className="absolute bottom-full left-0 mb-2 w-56 rounded-lg border border-border bg-surface-1 p-2 text-[11px] text-rose-700 shadow-sm">
          <div className="flex items-start gap-1">
            <p className="flex-1">{error}</p>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
