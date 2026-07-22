"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { supabase } from "@/lib/supabase/client";
import type { CallSessionSummary } from "@/lib/calls/types";

type Signal =
  | { type: "offer" | "answer"; sdp: RTCSessionDescriptionInit; senderId: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit; senderId: string };

type SignalEnvelope = {
  senderId: string;
  iv: string;
  ciphertext: string;
};

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function bytesToBase64Url(value: Uint8Array) {
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function encryptSignal(key: CryptoKey, signal: Signal): Promise<SignalEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(signal));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    senderId: signal.senderId,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

async function decryptSignal(key: CryptoKey, envelope: SignalEnvelope): Promise<Signal> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(envelope.iv) },
    key,
    base64UrlToBytes(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as Signal;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(await authHeaders()), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Call request failed.");
  return body;
}

export function useDirectP2PCall(params: {
  call: CallSessionSummary | null;
  userId: string;
  onEnded?: () => void;
}) {
  const [phase, setPhase] = useState<
    "lobby" | "connecting" | "connected" | "reconnecting" | "ended" | "failed"
  >("lobby");
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(Boolean(params.call?.videoEnabled));
  const [screenSharing, setScreenSharing] = useState(false);
  const [quality, setQuality] = useState({
    packetLoss: 0,
    jitterMs: 0,
    roundTripMs: 0,
    level: "good" as "good" | "fair" | "poor",
  });
  const [activeSpeakerParticipantId, setActiveSpeakerParticipantId] = useState<string | null>(null);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const offerTimerRef = useRef<number | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const aiAudioRef = useRef<{ audio: HTMLAudioElement; finish: () => void } | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const firstAudioReportedRef = useRef(false);
  const lastQualityTelemetryAtRef = useRef(0);
  const forceRelayRef = useRef(false);
  const callId = params.call?.id ?? null;

  const closeOnly = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((track) => track.stop());
    remoteRef.current?.getTracks().forEach((track) => track.stop());
    if (channelRef.current) void supabase.removeChannel(channelRef.current);
    if (offerTimerRef.current) window.clearInterval(offerTimerRef.current);
    offerTimerRef.current = null;
    channelRef.current = null;
    localRef.current = null;
    remoteRef.current = null;
    connectedAtRef.current = null;
    firstAudioReportedRef.current = false;
    setActiveSpeakerParticipantId(null);
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  const connect = useCallback(
    async (constraints?: {
      audioDeviceId?: string;
      videoDeviceId?: string;
      forceRelay?: boolean;
    }) => {
      if (!callId || pcRef.current) return;
      setPhase("connecting");
      setError(null);
      try {
        const deviceKey = "adehq.call.device-id.v1";
        const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
        localStorage.setItem(deviceKey, deviceId);
        deviceIdRef.current = deviceId;
        if (constraints?.forceRelay !== undefined) {
          forceRelayRef.current = constraints.forceRelay;
        }
        connectedAtRef.current = Date.now();
        await request(`/api/calls/${encodeURIComponent(callId)}/media/p2p`, {
          method: "POST",
          body: JSON.stringify({ deviceId, forceRelay: forceRelayRef.current }),
        });
        const [stream, ice, signalKeyResponse] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            audio: constraints?.audioDeviceId
              ? { deviceId: { exact: constraints.audioDeviceId } }
              : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: params.call?.videoEnabled
              ? constraints?.videoDeviceId
                ? { deviceId: { exact: constraints.videoDeviceId } }
                : { width: { ideal: 1280 }, height: { ideal: 720 } }
              : false,
          }),
          request<{ iceServers: RTCIceServer[]; iceTransportPolicy: RTCIceTransportPolicy }>(
            `/api/calls/turn-credentials?callId=${encodeURIComponent(callId)}&forceRelay=${forceRelayRef.current ? "1" : "0"}`,
          ),
          request<{ key: string }>(
            `/api/calls/${encodeURIComponent(callId)}/media/signal-key`,
          ),
        ]);
        const signalKey = await crypto.subtle.importKey(
          "raw",
          base64UrlToBytes(signalKeyResponse.key),
          "AES-GCM",
          false,
          ["encrypt", "decrypt"],
        );
        localRef.current = stream;
        setLocalStream(stream);
        const pc = new RTCPeerConnection({
          iceServers: ice.iceServers,
          iceTransportPolicy: ice.iceTransportPolicy,
          bundlePolicy: "max-bundle",
        });
        pcRef.current = pc;
        const remote = new MediaStream();
        remoteRef.current = remote;
        setRemoteStream(remote);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        pc.ontrack = (event) => {
          remote.addTrack(event.track);
          const next = new MediaStream(remote.getTracks());
          remoteRef.current = next;
          setRemoteStream(next);
          if (event.track.kind === "audio" && !firstAudioReportedRef.current) {
            firstAudioReportedRef.current = true;
            void request(`/api/calls/${encodeURIComponent(callId)}/telemetry`, {
              method: "POST",
              body: JSON.stringify({
                kind: "connected",
                topology: "p2p",
                timeToFirstAudioMs: Math.max(0, Date.now() - (connectedAtRef.current ?? Date.now())),
              }),
            }).catch(() => undefined);
          }
        };
        const channel = supabase.channel(`call-signal:${callId}`, {
          config: { broadcast: { self: false } },
        });
        channelRef.current = channel;
        const send = async (signal: Signal) =>
          channel.send({
            type: "broadcast",
            event: "signal",
            payload: await encryptSignal(signalKey, signal),
          });
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            void send({
              type: "candidate",
              candidate: event.candidate.toJSON(),
              senderId: params.userId,
            });
          }
        };
        channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
          const envelope = payload as SignalEnvelope;
          if (!envelope || envelope.senderId === params.userId) return;
          const signal = await decryptSignal(signalKey, envelope).catch(() => null);
          if (!signal || signal.senderId !== envelope.senderId) return;
          if (signal.type === "offer") {
            await pc.setRemoteDescription(signal.sdp);
            await pc.setLocalDescription(await pc.createAnswer());
            await send({ type: "answer", sdp: pc.localDescription!, senderId: params.userId });
          } else if (signal.type === "answer") {
            await pc.setRemoteDescription(signal.sdp);
            if (offerTimerRef.current) window.clearInterval(offerTimerRef.current);
            offerTimerRef.current = null;
          } else if (signal.type === "candidate") {
            await pc.addIceCandidate(signal.candidate).catch(() => undefined);
          }
        });
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") {
            if (offerTimerRef.current) window.clearInterval(offerTimerRef.current);
            offerTimerRef.current = null;
            setPhase("connected");
          }
          else if (pc.connectionState === "disconnected") {
            setPhase("reconnecting");
            if (params.call?.createdBy === params.userId) {
              window.setTimeout(async () => {
                if (pc.connectionState !== "disconnected") return;
                await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
                await send({
                  type: "offer",
                  sdp: pc.localDescription!,
                  senderId: params.userId,
                });
              }, 2_000);
            }
          }
          else if (pc.connectionState === "failed") {
            setPhase("failed");
            setError("Direct connection failed. Rejoin through the SFU.");
            void request(`/api/calls/${encodeURIComponent(callId)}/telemetry`, {
              method: "POST",
              body: JSON.stringify({ kind: "dropped", topology: "p2p" }),
            }).catch(() => undefined);
          }
        };
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("Signaling timed out.")), 8_000);
          channel.subscribe(async (status) => {
            if (status !== "SUBSCRIBED") return;
            window.clearTimeout(timeout);
            resolve();
          });
        });
        if (params.call?.createdBy === params.userId) {
          await pc.setLocalDescription(await pc.createOffer());
          await send({ type: "offer", sdp: pc.localDescription!, senderId: params.userId });
          offerTimerRef.current = window.setInterval(() => {
            if (pc.connectionState !== "connected" && pc.localDescription) {
              void send({
                type: "offer",
                sdp: pc.localDescription,
                senderId: params.userId,
              });
            }
          }, 2_000);
        }
        await request("/api/calls", {
          method: "PATCH",
          body: JSON.stringify({ callId, action: "active", deviceId }),
        });
      } catch (connectError) {
        closeOnly();
        setPhase("failed");
        setError(connectError instanceof Error ? connectError.message : "Direct call failed.");
      }
    },
    [callId, closeOnly, params.call?.createdBy, params.call?.videoEnabled, params.userId],
  );

  const end = useCallback(async () => {
    closeOnly();
    setPhase("ended");
    if (callId) {
      await request("/api/calls", {
        method: "PATCH",
        body: JSON.stringify({ callId, action: "ended", deviceId: deviceIdRef.current }),
      }).catch(() => undefined);
    }
    params.onEnded?.();
  }, [callId, closeOnly, params]);

  const reconnect = useCallback(async () => {
    closeOnly();
    await connect();
  }, [closeOnly, connect]);

  const toggleMute = useCallback(() => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  const toggleCamera = useCallback(async () => {
    const existing = localRef.current?.getVideoTracks()[0];
    if (existing) {
      existing.enabled = !existing.enabled;
      setCameraOn(existing.enabled);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    pcRef.current?.addTrack(track, stream);
    localRef.current?.addTrack(track);
    setLocalStream(new MediaStream(localRef.current?.getTracks() ?? stream.getTracks()));
    setCameraOn(true);
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const sender = pc.getSenders().find((item) => item.track?.kind === "video");
    if (screenSharing) {
      const displayTrack = sender?.track;
      await sender?.replaceTrack(localRef.current?.getVideoTracks()[0] ?? null);
      if (displayTrack && !localRef.current?.getVideoTracks().includes(displayTrack)) {
        displayTrack.stop();
      }
      setScreenSharing(false);
      return;
    }
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = display.getVideoTracks()[0];
    const activeSender = sender ?? pc.addTrack(track, display);
    if (sender) await sender.replaceTrack(track);
    track.onended = () => {
      void activeSender.replaceTrack(localRef.current?.getVideoTracks()[0] ?? null);
      setScreenSharing(false);
    };
    setScreenSharing(true);
  }, [screenSharing]);

  const switchAudioInput = useCallback(async (audioDeviceId: string) => {
    const pc = pcRef.current;
    if (!pc) return;
    const next = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: audioDeviceId }, echoCancellation: true },
      video: false,
    });
    const track = next.getAudioTracks()[0];
    const sender = pc.getSenders().find((item) => item.track?.kind === "audio");
    if (!sender || !track) return;
    const previous = sender.track;
    await sender.replaceTrack(track);
    previous?.stop();
    const tracks = localRef.current?.getTracks().filter((item) => item !== previous) ?? [];
    const stream = new MediaStream([...tracks, track]);
    localRef.current = stream;
    setLocalStream(stream);
  }, []);

  const switchVideoInput = useCallback(async (videoDeviceId: string) => {
    const pc = pcRef.current;
    if (!pc) return;
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: { exact: videoDeviceId } },
    });
    const track = next.getVideoTracks()[0];
    const sender = pc.getSenders().find((item) => item.track?.kind === "video");
    if (!sender || !track) return;
    const previous = sender.track;
    await sender.replaceTrack(track);
    previous?.stop();
    const tracks = localRef.current?.getTracks().filter((item) => item !== previous) ?? [];
    const stream = new MediaStream([...tracks, track]);
    localRef.current = stream;
    setLocalStream(stream);
    setCameraOn(true);
  }, []);

  useEffect(() => {
    if (phase !== "connected") return;
    const timer = window.setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      const stats = await pc.getStats();
      let lost = 0;
      let received = 0;
      let jitter = 0;
      let rtt = 0;
      let remoteAudioLevel = 0;
      let candidateType: "host" | "srflx" | "prflx" | "relay" | "unknown" = "unknown";
      stats.forEach((report) => {
        if (report.type === "inbound-rtp") {
          lost += Number(report.packetsLost ?? 0);
          received += Number(report.packetsReceived ?? 0);
          jitter = Math.max(jitter, Number(report.jitter ?? 0) * 1000);
          if (report.kind === "audio") {
            remoteAudioLevel = Math.max(remoteAudioLevel, Number(report.audioLevel ?? 0));
          }
        }
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          rtt = Math.max(rtt, Number(report.currentRoundTripTime ?? 0) * 1000);
          const candidate = stats.get(report.localCandidateId);
          if (["host", "srflx", "prflx", "relay"].includes(String(candidate?.candidateType))) {
            candidateType = candidate.candidateType;
          }
        }
      });
      const packetLoss = lost + received ? (lost / (lost + received)) * 100 : 0;
      setQuality({
        packetLoss,
        jitterMs: jitter,
        roundTripMs: rtt,
        level: packetLoss > 8 || rtt > 600 ? "poor" : packetLoss > 3 || rtt > 300 ? "fair" : "good",
      });
      const remoteParticipant = params.call?.participants.find(
        (participant) => participant.userId && participant.userId !== params.userId,
      );
      setActiveSpeakerParticipantId(
        remoteAudioLevel > 0.025 ? remoteParticipant?.id ?? "remote" : null,
      );
      if (callId && Date.now() - lastQualityTelemetryAtRef.current >= 30_000) {
        lastQualityTelemetryAtRef.current = Date.now();
        void request(`/api/calls/${encodeURIComponent(callId)}/telemetry`, {
          method: "POST",
          body: JSON.stringify({
            kind: "quality",
            topology: "p2p",
            packetLoss,
            jitterMs: jitter,
            roundTripMs: rtt,
            candidateType,
          }),
        }).catch(() => undefined);
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [callId, params.call?.participants, params.userId, phase]);

  useEffect(() => {
    if (!callId || !deviceIdRef.current || phase === "lobby" || phase === "ended") return;
    const heartbeat = () =>
      request("/api/calls", {
        method: "PATCH",
        body: JSON.stringify({
          callId,
          action: "heartbeat",
          deviceId: deviceIdRef.current,
        }),
      }).catch(() => undefined);
    void heartbeat();
    const timer = window.setInterval(heartbeat, 15_000);
    return () => window.clearInterval(timer);
  }, [callId, phase]);

  useEffect(() => () => closeOnly(), [closeOnly]);

  return {
    phase,
    error,
    localStream,
    remoteStream,
    muted,
    cameraOn,
    screenSharing,
    quality,
    activeSpeakerParticipantId,
    aiSpeaking,
    connect,
    reconnect,
    end,
    closeOnly,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    switchAudioInput,
    switchVideoInput,
    playAiVoice: async (url: string) => {
      const audio = new Audio(url);
      setAiSpeaking(true);
      try {
        await audio.play();
        await new Promise<void>((resolve) => {
          const finish = () => resolve();
          aiAudioRef.current = { audio, finish };
          audio.onended = finish;
          audio.onerror = finish;
        });
      } finally {
        if (aiAudioRef.current?.audio === audio) aiAudioRef.current = null;
        setAiSpeaking(false);
      }
    },
    stopAiVoice: () => {
      aiAudioRef.current?.audio.pause();
      aiAudioRef.current?.finish();
      aiAudioRef.current = null;
      setAiSpeaking(false);
    },
  };
}
