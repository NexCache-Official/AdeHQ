"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, X } from "lucide-react";
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

/**
 * Microphone control for Rooms/DMs: record → transcribe → editable insert.
 * No auto-send; user must review the transcript.
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
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => {
    clearTimer();
    mediaRef.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecording(false);
      clearTimer();
      return;
    }
    recorder.stop();
    setRecording(false);
    clearTimer();
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
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
          onTranscript(String(data.transcript ?? ""), {
            estimatedWh: Number(data.estimatedWh ?? 0),
            durationSeconds: Number(data.durationSeconds ?? durationSeconds),
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Transcription failed");
        } finally {
          setProcessing(false);
          setElapsedSec(0);
        }
      };
      mediaRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      recorder.start(250);
      setRecording(true);
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.round((Date.now() - startedAtRef.current) / 1000));
      }, 250);
    } catch {
      setError("Microphone permission is required for voice notes.");
    }
  }, [workspaceId, roomId, topicId, onTranscript]);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled || processing}
        onClick={() => (recording ? stopRecording() : void startRecording())}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-ink-2 hover:bg-surface-2 disabled:opacity-50",
          recording && "border-rose-300 bg-rose-50 text-rose-700",
        )}
        aria-label={recording ? "Stop recording" : "Record voice note"}
        title={recording ? "Stop recording" : "Voice note"}
      >
        {processing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : recording ? (
          <Square className="h-3.5 w-3.5 fill-current" />
        ) : (
          <Mic className="h-4 w-4" strokeWidth={1.8} />
        )}
      </button>
      {recording ? (
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-rose-700">
          {elapsedSec}s · tap to stop
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
