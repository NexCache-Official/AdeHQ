"use client";

import { useEffect, useRef, useState } from "react";
import {
  Captions,
  CaptionsOff,
  CircleStop,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Save,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useRealtimeBrainCall } from "@/hooks/useRealtimeBrainCall";

type Props = {
  workspaceId: string;
  roomId: string;
  employee: { id: string; name: string; role: string; accent: string };
  premiumVoice?: boolean;
  onEnd: () => void;
};

/** Keep call chrome feel like a phone call — only a few states matter. */
const ACTIVITY_LABEL: Record<string, string> = {
  connecting: "Connecting…",
  listening: "Listening…",
  transcribing: "Understanding…",
  thinking: "Understanding…",
  using_tools: "Working…",
  synthesizing: "Speaking…",
  speaking: "Speaking…",
  reconnecting: "Reconnecting…",
  failed: "Call needs attention",
  ended: "Call ended",
};

export function RealtimeBrainCallRoom({
  workspaceId,
  roomId,
  employee,
  premiumVoice = false,
  onEnd,
}: Props) {
  const call = useRealtimeBrainCall();
  const startedRef = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [showTranscript, setShowTranscript] = useState(true);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void call
      .start({
        workspaceId,
        conversationId: roomId,
        employeeId: employee.id,
        voice: premiumVoice ? "premium" : "standard",
      })
      .catch((error) => {
        setStartError(error instanceof Error ? error.message : "Could not start call.");
      });
    // The call hook deliberately owns its session for this component lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, roomId, employee.id, premiumVoice]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  async function endCall() {
    await call.end();
    onEnd();
  }

  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, "0");
  const connected = !["connecting", "reconnecting", "failed", "ended"].includes(
    call.activity,
  );

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
        <header className="relative z-10 flex items-center justify-between border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-ink">{employee.name}</h1>
            <p className="truncate text-xs text-ink-3">
              {employee.role} · {connected ? "On a call" : ACTIVITY_LABEL[call.activity]}
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs tabular-nums text-ink-2">
            <span>{minutes}:{seconds}</span>
            <span title={`Settled ${call.settledWh.toFixed(2)} WH`}>
              {call.estimatedWh.toFixed(2)} WH
            </span>
          </div>
        </header>

        <section className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="relative">
            <div
              className={cn(
                "absolute inset-0 rounded-full opacity-25 blur-2xl transition-transform duration-500 ease-out",
                call.activity === "speaking" ? "scale-125" : "scale-100",
              )}
              style={{ backgroundColor: employee.accent }}
            />
            <div
              className="relative flex h-28 w-28 items-center justify-center rounded-full text-3xl font-semibold text-white shadow-sm"
              style={{ backgroundColor: employee.accent }}
            >
              {employee.name
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")}
            </div>
            {call.activity === "listening" && (
              <div
                className="absolute inset-[-8px] rounded-full border border-accent-500/35 transition-transform duration-75"
                style={{
                  transform: `scale(${1 + Math.min(call.listeningLevel * 4, 0.12)})`,
                }}
              />
            )}
          </div>
          <h2 className="mt-6 text-lg font-medium text-ink">
            {ACTIVITY_LABEL[call.activity] ?? "Waiting for you…"}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-ink-3">
            {call.pushToTalk
              ? "Hold the talk button, then release to send."
              : "Talk like you would with a teammate. Pause briefly when you're done."}
          </p>
          {(call.error || startError) && (
            <p className="mt-4 max-w-md rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {call.error || startError}
            </p>
          )}
          {call.audioSuspended && (
            <Button className="mt-4" onClick={() => void call.resumeAudio()}>
              <Volume2 className="h-4 w-4" /> Enable call audio
            </Button>
          )}
        </section>

        <footer className="relative z-10 flex flex-wrap items-center justify-center gap-2 border-t border-border bg-surface/90 px-4 py-4 backdrop-blur">
          <button
            type="button"
            onClick={() => call.setMuted(!call.muted)}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl border border-border transition-colors",
              call.muted ? "bg-danger-soft text-danger" : "bg-surface text-ink-2 hover:bg-muted",
            )}
            aria-label={call.muted ? "Unmute" : "Mute"}
          >
            {call.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={call.interrupt}
            className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm text-ink-2 hover:bg-muted"
          >
            <CircleStop className="h-4 w-4" /> Interrupt
          </button>
          <button
            type="button"
            onClick={() => call.setPttMode(!call.pushToTalk)}
            className={cn(
              "flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm",
              call.pushToTalk ? "bg-accent-500 text-white" : "bg-surface text-ink-2 hover:bg-muted",
            )}
          >
            <Radio className="h-4 w-4" />
            {call.pushToTalk ? "Push to talk on" : "Push to talk"}
          </button>
          {call.pushToTalk && (
            <button
              type="button"
              onPointerDown={() => call.holdToTalk(true)}
              onPointerUp={() => call.holdToTalk(false)}
              onPointerCancel={() => call.holdToTalk(false)}
              onPointerLeave={() => call.holdToTalk(false)}
              className="flex h-11 items-center gap-2 rounded-xl bg-accent-500 px-4 text-sm font-medium text-white active:bg-accent-600"
            >
              <Mic className="h-4 w-4" /> Hold to speak
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowTranscript((value) => !value)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-ink-2 hover:bg-muted"
            aria-label={showTranscript ? "Hide transcript" : "Show transcript"}
          >
            {showTranscript ? <CaptionsOff className="h-5 w-5" /> : <Captions className="h-5 w-5" />}
          </button>
          <span className="hidden h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-xs text-ink-3 sm:flex">
            <Volume2 className="h-4 w-4" /> System volume
          </span>
          <Button variant="danger" onClick={() => void endCall()} className="h-11">
            <PhoneOff className="h-4 w-4" /> End call
          </Button>
        </footer>
      </main>

      {showTranscript && (
        <aside className="flex w-full max-w-sm flex-col border-l border-border bg-canvas lg:w-[320px]">
          <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">Live transcript</h2>
              <p className="text-[11px] text-ink-3">Also saved to your DM with {employee.name}</p>
            </div>
            {call.recordingAvailable && (
              <button
                type="button"
                onClick={() => void call.setSaveRecording(!call.recordingConsent)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px]",
                  call.recordingConsent
                    ? "border-accent-500/40 bg-accent-500/10 text-accent-700"
                    : "border-border text-ink-3",
                )}
              >
                <Save className="h-3.5 w-3.5" />
                {call.recordingConsent ? "Recording consented" : "Save recording"}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {call.transcript.length === 0 ? (
              <p className="text-sm text-ink-3">
                Your words appear after each pause. Their reply fades in as they speak.
              </p>
            ) : (
              call.transcript.map((line) => (
                <div
                  key={line.id}
                  className={cn(
                    "transition-opacity duration-300 ease-out",
                    line.final ? "opacity-100" : "opacity-70",
                  )}
                >
                  <p className="text-xs font-medium text-ink-2">
                    {line.speaker === "human" ? "You" : employee.name}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink">{line.text}</p>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-border bg-surface px-4 py-3 text-xs text-ink-3">
            Estimated {call.estimatedWh.toFixed(2)} WH · Settled {call.settledWh.toFixed(2)} WH
          </div>
        </aside>
      )}
    </div>
  );
}
