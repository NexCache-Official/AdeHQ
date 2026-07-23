"use client";

import { useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { playCallChime } from "@/lib/brain/voice/call-chimes";
import { LIVE_STT_MEDIA_BOUNDARY } from "@/lib/brain/voice/live-stt-config";
import { HybridLocalTurnDetector } from "@/lib/brain/voice/turn-detector";

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

function callClientDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem("adehq_live_call_debug") === "1") return true;
  } catch {
    /* ignore */
  }
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

function debugCall(...args: unknown[]) {
  if (callClientDebugEnabled()) {
    console.info("[AdeHQ live-call]", ...args);
  }
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
  const preRollPcmRef = useRef<Uint8Array[]>([]);
  const preRollBytesRef = useRef(0);
  const frameSequenceRef = useRef(0);
  const employeeDeltaRef = useRef("");
  const playbackQueueRef = useRef<
    Array<{
      bytes: Uint8Array;
      mimeType: string;
      sampleRate?: number;
      channels?: number;
    }>
  >([]);
  const playbackActiveRef = useRef(false);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const framedPlaybackActiveRef = useRef(false);
  const playbackCursorRef = useRef(0);
  const pcmRemainderRef = useRef(new Uint8Array(0));
  const playbackEndedAtRef = useRef(0);
  const bargeInStartedRef = useRef(0);
  const lastLevelPaintRef = useRef(0);
  const turnDetectorRef = useRef(new HybridLocalTurnDetector());
  const turnDecisionPendingRef = useRef(false);
  const connectedChimePlayedRef = useRef(false);

  function send(event: object) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(event));
    }
  }

  function clearPlayback(interrupt = false) {
    playbackQueueRef.current = [];
    for (const source of playbackSourcesRef.current) source.stop();
    playbackSourcesRef.current.clear();
    playbackSourceRef.current = null;
    framedPlaybackActiveRef.current = false;
    playbackActiveRef.current = false;
    playbackCursorRef.current = 0;
    pcmRemainderRef.current = new Uint8Array(0);
    playbackEndedAtRef.current = performance.now();
    if (interrupt) send({ type: "interrupt" });
  }

  function markPlaybackEndedIfIdle() {
    if (
      framedPlaybackActiveRef.current ||
      playbackSourcesRef.current.size ||
      playbackQueueRef.current.length
    ) {
      return;
    }
    playbackActiveRef.current = false;
    playbackCursorRef.current = 0;
    playbackEndedAtRef.current = performance.now();
    setActivity("listening");
  }

  function schedulePcm(
    context: AudioContext,
    bytes: Uint8Array,
    sampleRate = 24_000,
    channels = 1,
  ) {
    const pending = pcmRemainderRef.current;
    const combined = new Uint8Array(pending.byteLength + bytes.byteLength);
    combined.set(pending);
    combined.set(bytes, pending.byteLength);
    const frameBytes = Math.max(1, channels) * 2;
    const usableBytes = combined.byteLength - (combined.byteLength % frameBytes);
    pcmRemainderRef.current = combined.slice(usableBytes);
    if (!usableBytes) return;

    const frameCount = usableBytes / frameBytes;
    const audioBuffer = context.createBuffer(channels, frameCount, sampleRate);
    const view = new DataView(combined.buffer, combined.byteOffset, usableBytes);
    for (let channel = 0; channel < channels; channel += 1) {
      const output = audioBuffer.getChannelData(channel);
      for (let frame = 0; frame < frameCount; frame += 1) {
        output[frame] =
          view.getInt16((frame * channels + channel) * 2, true) / 32_768;
      }
    }
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    const startsAt = Math.max(context.currentTime + 0.015, playbackCursorRef.current);
    playbackCursorRef.current = startsAt + audioBuffer.duration;
    playbackSourcesRef.current.add(source);
    playbackActiveRef.current = true;
    setActivity("speaking");
    source.onended = () => {
      playbackSourcesRef.current.delete(source);
      markPlaybackEndedIfIdle();
    };
    source.start(startsAt);
  }

  async function playNext() {
    if (framedPlaybackActiveRef.current) return;
    const item = playbackQueueRef.current.shift();
    if (!item) {
      markPlaybackEndedIfIdle();
      return;
    }
    const context = contextRef.current;
    if (!context) return;
    if (context.state === "suspended") {
      playbackQueueRef.current.unshift(item);
      setAudioSuspended(true);
      return;
    }
    if (item.mimeType === "audio/pcm") {
      schedulePcm(context, item.bytes, item.sampleRate, item.channels);
      void playNext();
      return;
    }
    framedPlaybackActiveRef.current = true;
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
      playbackSourcesRef.current.add(source);
      const startsAt = Math.max(context.currentTime + 0.015, playbackCursorRef.current);
      playbackCursorRef.current = startsAt + buffer.duration;
      source.onended = () => {
        playbackSourcesRef.current.delete(source);
        framedPlaybackActiveRef.current = false;
        playbackSourceRef.current = null;
        void playNext();
      };
      source.start(startsAt);
    } catch {
      framedPlaybackActiveRef.current = false;
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
    preRollPcmRef.current = [];
    preRollBytesRef.current = 0;
    speakingRef.current = false;
    speechStartedRef.current = 0;
    lastVoiceRef.current = 0;
    setActivity("transcribing");
  }

  function rememberPreRoll(pcm: Uint8Array) {
    const maximumBytes =
      (LIVE_STT_MEDIA_BOUNDARY.sampleRate *
        LIVE_STT_MEDIA_BOUNDARY.channels *
        2 *
        LIVE_STT_MEDIA_BOUNDARY.preRollMs) /
      1000;
    preRollPcmRef.current.push(pcm);
    preRollBytesRef.current += pcm.byteLength;
    while (
      preRollBytesRef.current > maximumBytes &&
      preRollPcmRef.current.length > 1
    ) {
      preRollBytesRef.current -= preRollPcmRef.current.shift()?.byteLength ?? 0;
    }
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
    // Slightly higher than ambient room noise / laptop fans so idle calls do
    // not open phantom turns that STT fills with "Thank you."
    const voice = level >= 0.038;
    const canCapture =
      !pttRef.current || pttHeldRef.current;
    if (!canCapture) return;

    if (playbackActiveRef.current && !bargeInEnabledRef.current) return;
    if (playbackActiveRef.current && voice) {
      if (!bargeInStartedRef.current) bargeInStartedRef.current = now;
      if (now - bargeInStartedRef.current >= 280) {
        clearPlayback(true);
        speakingRef.current = true;
        speechStartedRef.current = now;
      }
    } else if (!voice) {
      bargeInStartedRef.current = 0;
    }

    // After the employee finishes speaking, suppress mic commits long enough
    // that echo / room wash does not become a fake human turn.
    const postPlaybackSuppressed =
      !playbackActiveRef.current && now - playbackEndedAtRef.current < 450;
    if (postPlaybackSuppressed && !pttHeldRef.current) return;

    if (voice && !speakingRef.current) {
      speakingRef.current = true;
      speechStartedRef.current = now;
      // Include only a short local pre-roll so initial consonants are not
      // clipped. Idle room audio is never forwarded to the provider stream.
      for (const frame of preRollPcmRef.current) {
        pendingPcmRef.current.push(frame);
        pendingSamplesRef.current += frame.byteLength / 2;
      }
      preRollPcmRef.current = [];
      preRollBytesRef.current = 0;
      setActivity("listening");
    }
    if (!speakingRef.current) {
      rememberPreRoll(pcm);
      return;
    }
    pendingPcmRef.current.push(pcm);
    pendingSamplesRef.current += pcm.byteLength / 2;
    if (voice) lastVoiceRef.current = now;
    if (pendingPcmRef.current.length >= 12) flushPcm();

    const sustainedSpeechMs = now - speechStartedRef.current;
    const silenceMs = lastVoiceRef.current ? now - lastVoiceRef.current : 0;
    if (
      !pttRef.current &&
      sustainedSpeechMs >= 450 &&
      silenceMs >= 550 &&
      !turnDecisionPendingRef.current
    ) {
      turnDecisionPendingRef.current = true;
      void turnDetectorRef.current
        .evaluate({
          speechDurationMs: sustainedSpeechMs,
          silenceDurationMs: silenceMs,
          // Until the ONNX Smart Turn worker supplies real semantic confidence,
          // only treat a ~1.1s pause as complete (hard fallback ~1.8s).
          semanticCompletionConfidence: silenceMs >= 1100 ? 0.75 : 0,
        })
        .then((decision) => {
          if (!decision.commit || !speakingRef.current) return;
          flushPcm();
          commitUtterance();
        })
        .finally(() => {
          turnDecisionPendingRef.current = false;
        });
    }
  }

  function handleServerEvent(event: Record<string, unknown>) {
    const type = String(event.type ?? "");
    debugCall("event", type, event);
    if (type === "session.ready") {
      socketReadyRef.current = true;
      reconnectDelayRef.current = 1000;
      setActivity("listening");
      if (contextRef.current && !connectedChimePlayedRef.current) {
        connectedChimePlayedRef.current = true;
        playCallChime(contextRef.current, "connected");
      }
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
        // Soft-skipped noise turns never emit transcript.final — drop the draft
        // so phantom "Thank you." captions do not linger in the call UI.
        if (next === "listening") {
          setTranscript((current) =>
            current.filter((line) => line.id !== "human-draft"),
          );
        }
      } else if (turn === "interrupted") {
        setActivity("listening");
        setTranscript((current) =>
          current.filter((line) => line.id !== "human-draft"),
        );
      }
      return;
    }
    if (type === "employee.audio.end") {
      // finishPlayback() owns the return-to-listening transition once queued
      // audio has started. Only fall back here when the turn produced no audio.
      if (playbackActiveRef.current || playbackQueueRef.current.length > 0) {
        return;
      }
      setActivity("listening");
      return;
    }
    if (type === "transcript.partial") {
      setTranscript((current) => [
        ...current.filter((line) => line.id !== "human-draft"),
        {
          id: "human-draft",
          speaker: "human",
          text: String(event.text ?? ""),
          final: false,
        },
      ]);
      return;
    }
    if (type === "transcript.final") {
      debugCall("transcript.final", {
        text: event.text,
        source: event.source,
      });
      setTranscript((current) => [
        ...current.filter((line) => line.id !== "human-draft"),
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
      // Hold the employee draft until audio is actually playing so the side
      // transcript doesn't jump ahead of the voice by a second or two.
      if (playbackActiveRef.current || playbackQueueRef.current.length > 0) {
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
      }
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
        sampleRate:
          typeof event.sampleRate === "number" ? event.sampleRate : undefined,
        channels: typeof event.channels === "number" ? event.channels : undefined,
      });
      // Reveal buffered employee text as soon as the first audio chunk arrives.
      if (employeeDeltaRef.current) {
        const draft = employeeDeltaRef.current;
        setTranscript((current) => {
          const withoutDraft = current.filter((line) => line.id !== "employee-draft");
          return [
            ...withoutDraft,
            {
              id: "employee-draft",
              speaker: "employee",
              text: draft,
              final: false,
            },
          ];
        });
      }
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
      const message = String(event.message ?? "Call error.");
      // Soft STT skips are recoverable and should not flash call chrome.
      if (/no speech was detected|stt_hallucination/i.test(message)) {
        setActivity("listening");
        return;
      }
      setError(message);
    }
  }

  function openSocket(path: string) {
    const url = new URL(path, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    debugCall("opening socket", url.pathname);
    const socket = new WebSocket(url);
    socketRef.current = socket;
    const openTimeout = setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        debugCall("socket open timeout");
        socket.close();
        setActivity("failed");
        setError("Could not connect the call transport. Retry the call.");
      }
    }, 12_000);
    socket.addEventListener("open", () => {
      clearTimeout(openTimeout);
      debugCall("socket open");
    });
    socket.addEventListener("error", () => {
      clearTimeout(openTimeout);
      debugCall("socket error");
      setError("Call transport failed to connect.");
    });
    socket.addEventListener("message", (message) => {
      try {
        handleServerEvent(JSON.parse(String(message.data)) as Record<string, unknown>);
      } catch {
        setError("The call received an invalid event.");
      }
    });
    socket.addEventListener("close", () => {
      clearTimeout(openTimeout);
      socketReadyRef.current = false;
      socketRef.current = null;
      if (intentionalCloseRef.current) return;
      setActivity("reconnecting");
      const reconnectPath = transportUrlRef.current;
      if (!reconnectPath) return;
      if (reconnectDelayRef.current > 16_000) {
        setActivity("failed");
        setError("Could not reconnect the call. End and start a new call.");
        return;
      }
      reconnectTimerRef.current = setTimeout(() => {
        openSocket(reconnectPath);
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30_000);
      }, reconnectDelayRef.current);
    });
  }

  async function endSessionQuietly() {
    if (!callIdRef.current || !workspaceRef.current) return;
    try {
      const headers = await authHeaders(workspaceRef.current);
      await fetch("/api/calls/live/session", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ callId: callIdRef.current, action: "end" }),
      });
    } catch {
      /* ignore cleanup failures */
    }
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
    connectedChimePlayedRef.current = false;
    workspaceRef.current = input.workspaceId;
    try {
      debugCall("creating session", {
        conversationId: input.conversationId,
        employeeId: input.employeeId,
        voice: input.voice,
      });
      const mediaPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const sessionPromise = authHeaders(input.workspaceId).then((headers) =>
        fetch("/api/calls/live/session", {
          method: "POST",
          headers,
          body: JSON.stringify({
            conversationType: "human_ai_dm",
            conversationId: input.conversationId,
            employeeId: input.employeeId,
            sttMode: "live_streaming",
            voice: input.voice,
          }),
        }),
      );
      const [mediaResult, sessionResult] = await Promise.allSettled([
        mediaPromise,
        sessionPromise,
      ]);
      if (mediaResult.status === "rejected") throw mediaResult.reason;
      const stream = mediaResult.value;
      streamRef.current = stream;
      if (sessionResult.status === "rejected") throw sessionResult.reason;
      const response = sessionResult.value;
      const data = (await response.json()) as SessionResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not start call.");
      callIdRef.current = data.callId;
      tokenRef.current = data.sessionToken;
      transportUrlRef.current = data.transportUrl;
      bargeInEnabledRef.current = data.bargeInEnabled !== false;
      setRecordingAvailable(Boolean(data.entitlements?.recordingEnabled));
      debugCall("session created", {
        callId: data.callId,
        recordingEnabled: data.entitlements?.recordingEnabled,
      });

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
      await endSessionQuietly();
      callIdRef.current = null;
      setActivity("failed");
      const message =
        startError instanceof Error ? startError.message : "Could not start call.";
      setError(message);
      debugCall("start failed", message);
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
    if (contextRef.current) playCallChime(contextRef.current, "disconnected");
    connectedChimePlayedRef.current = false;
    await new Promise((resolve) => setTimeout(resolve, 190));
    await contextRef.current?.close();
    await endSessionQuietly();
    callIdRef.current = null;
    setActivity("ended");
  }

  function setMuted(next: boolean) {
    mutedRef.current = next;
    if (next) {
      pendingPcmRef.current = [];
      pendingSamplesRef.current = 0;
      preRollPcmRef.current = [];
      preRollBytesRef.current = 0;
      speakingRef.current = false;
      speechStartedRef.current = 0;
      lastVoiceRef.current = 0;
    }
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
      const headers = await authHeaders(workspaceRef.current);
      const response = await fetch("/api/calls/live/session", {
        method: "PATCH",
        headers,
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
      send({ type: "end_call" });
      socketRef.current?.close();
      workletRef.current?.disconnect();
      sourceRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void contextRef.current?.close();
      void endSessionQuietly();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
