"use client";

import { useEffect, useRef, useState } from "react";

export type LiveCallActivity =
  | "connecting"
  | "listening"
  | "transcribing"
  | "thinking"
  | "using_tools"
  | "synthesizing"
  | "speaking"
  | "reconnecting"
  | "ended"
  | "failed";

export type LiveTranscriptLine = {
  id: string;
  speaker: "human" | "employee";
  text: string;
  final: boolean;
};

type StartInput = {
  workspaceId: string;
  conversationId: string;
  employeeId: string;
  voice: "standard" | "premium";
};

type SessionResponse = {
  callId: string;
  sessionToken: string;
  transportUrl: string;
  entitlements?: { recordingEnabled?: boolean };
  bargeInEnabled?: boolean;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function useRealtimeBrainCall() {
  const [activity, setActivity] = useState<LiveCallActivity>("ended");
  const [transcript, setTranscript] = useState<LiveTranscriptLine[]>([]);
  const [listeningLevel, setListeningLevel] = useState(0);
  const [estimatedWh, setEstimatedWh] = useState(0);
  const [settledWh, setSettledWh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [recordingAvailable, setRecordingAvailable] = useState(false);
  const [audioSuspended, setAudioSuspended] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const socketReadyRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const callIdRef = useRef<string | null>(null);
  const workspaceRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const transportUrlRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const intentionalCloseRef = useRef(false);
  const mutedRef = useRef(false);
  const pttRef = useRef(false);
  const pttHeldRef = useRef(false);
  const speakingRef = useRef(false);
  const bargeInEnabledRef = useRef(true);
  const speechStartedRef = useRef(0);
  const lastVoiceRef = useRef(0);
  const pendingPcmRef = useRef<Uint8Array[]>([]);
  const pendingSamplesRef = useRef(0);
  const frameSequenceRef = useRef(0);
  const employeeDeltaRef = useRef("");
  const playbackQueueRef = useRef<Array<{ bytes: Uint8Array; mimeType: string }>>([]);
  const playbackActiveRef = useRef(false);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackEndedAtRef = useRef(0);
  const bargeInStartedRef = useRef(0);
  const lastLevelPaintRef = useRef(0);

  function send(event: object) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(event));
    }
  }

  function clearPlayback(interrupt = false) {
    playbackQueueRef.current = [];
    playbackSourceRef.current?.stop();
    playbackSourceRef.current = null;
    playbackActiveRef.current = false;
    playbackEndedAtRef.current = performance.now();
    if (interrupt) send({ type: "interrupt" });
  }

  async function playNext() {
    if (playbackActiveRef.current) return;
    const item = playbackQueueRef.current.shift();
    if (!item) {
      playbackEndedAtRef.current = performance.now();
      if (activity === "speaking") setActivity("listening");
      return;
    }
    const context = contextRef.current;
    if (!context) return;
    if (context.state === "suspended") {
      playbackQueueRef.current.unshift(item);
      setAudioSuspended(true);
      return;
    }
    playbackActiveRef.current = true;
    setActivity("speaking");
    try {
      const audioCopy = new Uint8Array(item.bytes.byteLength);
      audioCopy.set(item.bytes);
      const buffer = await context.decodeAudioData(audioCopy.buffer);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      playbackSourceRef.current = source;
      source.onended = () => {
        playbackActiveRef.current = false;
        playbackSourceRef.current = null;
        void playNext();
      };
      source.start();
    } catch {
      playbackActiveRef.current = false;
      setError("A voice segment could not be played. The transcript is still available.");
      void playNext();
    }
  }

  function commitUtterance() {
    if (!speakingRef.current || pendingSamplesRef.current <= 0) return;
    const durationSeconds = pendingSamplesRef.current / 16_000;
    send({ type: "audio.commit", durationSeconds, mimeType: "audio/pcm" });
    pendingPcmRef.current = [];
    pendingSamplesRef.current = 0;
    speakingRef.current = false;
    speechStartedRef.current = 0;
    lastVoiceRef.current = 0;
    setActivity("transcribing");
  }

  function flushPcm() {
    if (!pendingPcmRef.current.length) return;
    const totalBytes = pendingPcmRef.current.reduce((sum, item) => sum + item.byteLength, 0);
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const item of pendingPcmRef.current) {
      merged.set(item, offset);
      offset += item.byteLength;
    }
    pendingPcmRef.current = [];
    send({
      type: "audio.append",
      pcm: bytesToBase64(merged),
      sequence: frameSequenceRef.current++,
    });
  }

  function processCapture(pcm: Uint8Array, level: number) {
    const now = performance.now();
    if (now - lastLevelPaintRef.current >= 50) {
      lastLevelPaintRef.current = now;
      setListeningLevel(level);
    }
    if (mutedRef.current || !socketReadyRef.current) return;
    const voice = level >= 0.022;
    const canCapture =
      !pttRef.current || pttHeldRef.current;
    if (!canCapture) return;

    if (playbackActiveRef.current && !bargeInEnabledRef.current) return;
    if (playbackActiveRef.current && voice) {
      if (!bargeInStartedRef.current) bargeInStartedRef.current = now;
      if (now - bargeInStartedRef.current >= 220) {
        clearPlayback(true);
        speakingRef.current = true;
        speechStartedRef.current = now;
      }
    } else if (!voice) {
      bargeInStartedRef.current = 0;
    }

    const postPlaybackSuppressed =
      !playbackActiveRef.current && now - playbackEndedAtRef.current < 180;
    if (postPlaybackSuppressed && !pttHeldRef.current) return;

    if (voice && !speakingRef.current) {
      speakingRef.current = true;
      speechStartedRef.current = now;
      setActivity("listening");
    }
    if (!speakingRef.current) return;
    pendingPcmRef.current.push(pcm);
    pendingSamplesRef.current += pcm.byteLength / 2;
    if (voice) lastVoiceRef.current = now;
    if (pendingPcmRef.current.length >= 12) flushPcm();

    const sustainedSpeechMs = now - speechStartedRef.current;
    const silenceMs = lastVoiceRef.current ? now - lastVoiceRef.current : 0;
    if (!pttRef.current && sustainedSpeechMs >= 250 && silenceMs >= 650) {
      flushPcm();
      commitUtterance();
    }
  }

  function handleServerEvent(event: Record<string, unknown>) {
    const type = String(event.type ?? "");
    if (type === "session.ready") {
      socketReadyRef.current = true;
      reconnectDelayRef.current = 1000;
      setActivity("listening");
      return;
    }
    if (type === "state.changed") {
      const session = String(event.session ?? "");
      const turn = String(event.turn ?? "");
      const next = session === "reconnecting" ? "reconnecting" : turn;
      if (
        [
          "listening",
          "transcribing",
          "thinking",
          "using_tools",
          "synthesizing",
          "speaking",
        ].includes(next)
      ) {
        setActivity(next as LiveCallActivity);
      }
      return;
    }
    if (type === "transcript.final") {
      setTranscript((current) => [
        ...current,
        {
          id: `human-${Date.now()}`,
          speaker: "human",
          text: String(event.text ?? ""),
          final: true,
        },
      ]);
      return;
    }
    if (type === "employee.text.delta") {
      employeeDeltaRef.current += String(event.text ?? "");
      setTranscript((current) => {
        const withoutDraft = current.filter((line) => line.id !== "employee-draft");
        return [
          ...withoutDraft,
          {
            id: "employee-draft",
            speaker: "employee",
            text: employeeDeltaRef.current,
            final: false,
          },
        ];
      });
      return;
    }
    if (type === "employee.text.final") {
      const text = String(event.text ?? employeeDeltaRef.current);
      employeeDeltaRef.current = "";
      setTranscript((current) => [
        ...current.filter((line) => line.id !== "employee-draft"),
        { id: `employee-${Date.now()}`, speaker: "employee", text, final: true },
      ]);
      return;
    }
    if (type === "employee.audio.delta") {
      playbackQueueRef.current.push({
        bytes: base64ToBytes(String(event.audio ?? "")),
        mimeType: String(event.mimeType ?? "audio/mpeg"),
      });
      void playNext();
      return;
    }
    if (type === "usage.estimate") {
      setEstimatedWh(Number(event.wh ?? 0));
      return;
    }
    if (type === "usage.settled") {
      const components = (event.components ?? {}) as Record<string, unknown>;
      const total =
        Number(components.sttWh ?? 0) +
        Number(components.brainWh ?? 0) +
        Number(components.ttsWh ?? 0);
      setSettledWh((current) => current + total);
      setEstimatedWh((current) => Math.max(current, total));
      return;
    }
    if (type === "error") {
      setError(String(event.message ?? "Call error."));
    }
  }

  function openSocket(path: string) {
    const url = new URL(path, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    socketRef.current = socket;
    socket.addEventListener("message", (message) => {
      try {
        handleServerEvent(JSON.parse(String(message.data)) as Record<string, unknown>);
      } catch {
        setError("The call received an invalid event.");
      }
    });
    socket.addEventListener("close", () => {
      socketReadyRef.current = false;
      socketRef.current = null;
      if (intentionalCloseRef.current) return;
      setActivity("reconnecting");
      const reconnectPath = transportUrlRef.current;
      if (!reconnectPath) return;
      reconnectTimerRef.current = setTimeout(() => {
        openSocket(reconnectPath);
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30_000);
      }, reconnectDelayRef.current);
    });
  }

  async function start(input: StartInput) {
    setError(null);
    setTranscript([]);
    setEstimatedWh(0);
    setSettledWh(0);
    setRecordingAvailable(false);
    setRecordingConsent(false);
    setAudioSuspended(false);
    setActivity("connecting");
    intentionalCloseRef.current = false;
    workspaceRef.current = input.workspaceId;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const response = await fetch("/api/calls/live/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-adehq-workspace-id": input.workspaceId,
        },
        body: JSON.stringify({
          conversationType: "human_ai_dm",
          conversationId: input.conversationId,
          employeeId: input.employeeId,
          sttMode: "fast_turn",
          voice: input.voice,
        }),
      });
      const data = (await response.json()) as SessionResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not start call.");
      callIdRef.current = data.callId;
      tokenRef.current = data.sessionToken;
      transportUrlRef.current = data.transportUrl;
      bargeInEnabledRef.current = data.bargeInEnabled !== false;
      setRecordingAvailable(Boolean(data.entitlements?.recordingEnabled));

      const context = new AudioContext({ latencyHint: "interactive" });
      contextRef.current = context;
      context.addEventListener("statechange", () => {
        setAudioSuspended(context.state === "suspended");
      });
      await context.resume().catch(() => undefined);
      setAudioSuspended(context.state === "suspended");
      await context.audioWorklet.addModule("/audio-worklets/call-capture.js");
      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;
      const worklet = new AudioWorkletNode(context, "adehq-call-capture");
      workletRef.current = worklet;
      worklet.port.onmessage = (
        message: MessageEvent<{ pcm: ArrayBuffer; level: number }>,
      ) => {
        processCapture(new Uint8Array(message.data.pcm), message.data.level);
      };
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(worklet).connect(silent).connect(context.destination);
      openSocket(data.transportUrl);
    } catch (startError) {
      socketReadyRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      await contextRef.current?.close().catch(() => undefined);
      setActivity("failed");
      const message =
        startError instanceof Error ? startError.message : "Could not start call.";
      setError(message);
      throw startError;
    }
  }

  async function end() {
    intentionalCloseRef.current = true;
    socketReadyRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    send({ type: "end_call" });
    clearPlayback();
    socketRef.current?.close();
    workletRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    await contextRef.current?.close();
    if (callIdRef.current && workspaceRef.current) {
      await fetch("/api/calls/live/session", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-adehq-workspace-id": workspaceRef.current,
        },
        body: JSON.stringify({ callId: callIdRef.current, action: "end" }),
      }).catch(() => undefined);
    }
    setActivity("ended");
  }

  function setMuted(next: boolean) {
    mutedRef.current = next;
    setMutedState(next);
    send({ type: "mute", muted: next });
  }

  function setPttMode(next: boolean) {
    pttRef.current = next;
    setPushToTalk(next);
  }

  function holdToTalk(held: boolean) {
    pttHeldRef.current = held;
    if (!held && speakingRef.current) {
      flushPcm();
      commitUtterance();
    }
  }

  async function setSaveRecording(next: boolean) {
    if (!recordingAvailable || !callIdRef.current || !workspaceRef.current) return;
    try {
      const response = await fetch("/api/calls/live/session", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-adehq-workspace-id": workspaceRef.current,
        },
        body: JSON.stringify({
          callId: callIdRef.current,
          action: "recording_consent",
          recordingConsent: next,
        }),
      });
      if (!response.ok) throw new Error("Could not update recording consent.");
      setRecordingConsent(next);
    } catch (consentError) {
      setError(
        consentError instanceof Error
          ? consentError.message
          : "Could not update recording consent.",
      );
    }
  }

  async function resumeAudio() {
    const context = contextRef.current;
    if (!context) return;
    await context.resume();
    setAudioSuspended(context.state === "suspended");
    if (context.state === "running") void playNext();
  }

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      workletRef.current?.disconnect();
      sourceRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void contextRef.current?.close();
    };
  }, []);

  return {
    activity,
    transcript,
    listeningLevel,
    estimatedWh,
    settledWh,
    error,
    muted,
    pushToTalk,
    recordingConsent,
    recordingAvailable,
    audioSuspended,
    start,
    end,
    interrupt: () => clearPlayback(true),
    setMuted,
    setPttMode,
    holdToTalk,
    setSaveRecording,
    resumeAudio,
  };
}
