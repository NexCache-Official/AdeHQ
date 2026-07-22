"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import type {
  CallSessionSummary,
  CloudflareSessionDescription,
  CloudflareTrackDescriptor,
} from "@/lib/calls/types";

type Quality = {
  packetLoss: number;
  jitterMs: number;
  roundTripMs: number;
  level: "good" | "fair" | "poor";
};

function getVideoConstraints(
  quality: "360p" | "720p" | "1080p" | undefined,
  deviceId?: string,
): MediaTrackConstraints {
  const dimensions =
    quality === "1080p"
      ? { width: { ideal: 1920 }, height: { ideal: 1080 } }
      : quality === "360p"
        ? { width: { ideal: 640 }, height: { ideal: 360 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } };
  return {
    ...dimensions,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

function getDeviceId() {
  const key = "adehq.call.device-id.v1";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  localStorage.setItem(key, value);
  return value;
}

async function jsonRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(await authHeaders()), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

export function useHumanSfuCall(params: {
  call: CallSessionSummary | null;
  userId: string;
  onEnded?: () => void;
}) {
  const onEnded = params.onEnded;
  const [phase, setPhase] = useState<
    "lobby" | "connecting" | "connected" | "reconnecting" | "ended" | "failed"
  >("lobby");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(Boolean(params.call?.videoEnabled));
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [quality, setQuality] = useState<Quality>({
    packetLoss: 0,
    jitterMs: 0,
    roundTripMs: 0,
    level: "good",
  });
  const [activeSpeakerParticipantId, setActiveSpeakerParticipantId] = useState<string | null>(null);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const subscribedRef = useRef(new Set<string>());
  const endingRef = useRef(false);
  const deviceIdRef = useRef<string | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const firstAudioReportedRef = useRef(false);
  const lastQualityTelemetryAtRef = useRef(0);
  const aiPlaybackRef = useRef<{ audio: HTMLAudioElement; finish: () => void } | null>(null);
  const forceRelayRef = useRef(false);

  const callId = params.call?.id ?? null;

  const closeMedia = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    sessionIdRef.current = null;
    subscribedRef.current.clear();
    connectedAtRef.current = null;
    firstAudioReportedRef.current = false;
    setActiveSpeakerParticipantId(null);
  }, []);

  const subscribePeerTracks = useCallback(
    async (call: CallSessionSummary) => {
      const pc = pcRef.current;
      const ownSessionId = sessionIdRef.current;
      if (!pc || !ownSessionId || !callId) return;
      const remote = call.participants.filter(
        (participant) =>
          participant.userId !== params.userId &&
          participant.providerSessionId &&
          participant.publishedTracks.length,
      );
      const tracks: CloudflareTrackDescriptor[] = [];
      for (const participant of remote) {
        for (const track of participant.publishedTracks) {
          const key = `${participant.providerSessionId}:${track.trackName}`;
          if (subscribedRef.current.has(key)) continue;
          tracks.push({
            location: "remote",
            sessionId: participant.providerSessionId!,
            trackName: track.trackName,
          });
          subscribedRef.current.add(key);
        }
      }
      if (!tracks.length) return;
      try {
        const result = await jsonRequest<{
          requiresImmediateRenegotiation?: boolean;
          sessionDescription?: CloudflareSessionDescription;
        }>(`/api/calls/${encodeURIComponent(callId)}/media/tracks`, {
          method: "POST",
          body: JSON.stringify({ sessionId: ownSessionId, tracks }),
        });
        if (result.requiresImmediateRenegotiation && result.sessionDescription?.type === "offer") {
          await pc.setRemoteDescription(result.sessionDescription);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await jsonRequest(`/api/calls/${encodeURIComponent(callId)}/media/renegotiate`, {
            method: "PUT",
            body: JSON.stringify({
              sessionId: ownSessionId,
              sessionDescription: pc.localDescription,
            }),
          });
        }
      } catch (subscriptionError) {
        for (const track of tracks) {
          subscribedRef.current.delete(`${track.sessionId}:${track.trackName}`);
        }
        throw subscriptionError;
      }
    },
    [callId, params.userId],
  );

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
        await import("webrtc-adapter");
        const deviceId = getDeviceId();
        deviceIdRef.current = deviceId;
        if (constraints?.forceRelay !== undefined) {
          forceRelayRef.current = constraints.forceRelay;
        }
        connectedAtRef.current = Date.now();
        const audioConstraints = constraints?.audioDeviceId
          ? { deviceId: { exact: constraints.audioDeviceId }, echoCancellation: true }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        const videoConstraints = params.call?.videoEnabled
          ? getVideoConstraints(
              params.call.entitlements?.maxVideoQuality,
              constraints?.videoDeviceId,
            )
          : false;
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: videoConstraints,
          });
        } catch (mediaError) {
          if (!videoConstraints) throw mediaError;
          stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false,
          });
          setCameraOn(false);
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        const ice = await jsonRequest<{
          iceServers: RTCIceServer[];
          iceTransportPolicy: RTCIceTransportPolicy;
        }>(
          `/api/calls/turn-credentials?callId=${encodeURIComponent(callId)}&forceRelay=${constraints?.forceRelay ? "1" : "0"}`,
        );
        const pc = new RTCPeerConnection({
          iceServers: ice.iceServers,
          iceTransportPolicy: ice.iceTransportPolicy,
          bundlePolicy: "max-bundle",
        });
        pcRef.current = pc;
        const incoming = new MediaStream();
        remoteStreamRef.current = incoming;
        setRemoteStream(incoming);
        pc.ontrack = (event) => {
          incoming.addTrack(event.track);
          const next = new MediaStream(incoming.getTracks());
          remoteStreamRef.current = next;
          setRemoteStream(next);
          if (event.track.kind === "audio" && !firstAudioReportedRef.current) {
            firstAudioReportedRef.current = true;
            void jsonRequest(`/api/calls/${encodeURIComponent(callId)}/telemetry`, {
              method: "POST",
              body: JSON.stringify({
                kind: "connected",
                topology: "sfu",
                timeToFirstAudioMs: Math.max(0, Date.now() - (connectedAtRef.current ?? Date.now())),
              }),
            }).catch(() => undefined);
          }
        };
        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
            if (phase === "reconnecting") {
              void jsonRequest(`/api/calls/${encodeURIComponent(callId)}/telemetry`, {
                method: "POST",
                body: JSON.stringify({ kind: "reconnected", topology: "sfu" }),
              }).catch(() => undefined);
            }
            setPhase("connected");
          } else if (pc.iceConnectionState === "disconnected") {
            setPhase("reconnecting");
          } else if (pc.iceConnectionState === "failed") {
            setPhase("failed");
            setError("The media connection was lost. Try reconnecting.");
            void jsonRequest(`/api/calls/${encodeURIComponent(callId)}/telemetry`, {
              method: "POST",
              body: JSON.stringify({ kind: "dropped", topology: "sfu" }),
            }).catch(() => undefined);
          }
        };
        const transceivers = stream.getTracks().map((track) =>
          pc.addTransceiver(track, { direction: "sendonly", streams: [stream] }),
        );
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const created = await jsonRequest<{
          sessionId: string;
          sessionDescription: CloudflareSessionDescription;
        }>(`/api/calls/${encodeURIComponent(callId)}/media/session`, {
          method: "POST",
          body: JSON.stringify({
            sessionDescription: pc.localDescription,
            deviceId,
            forceRelay: forceRelayRef.current,
          }),
        });
        sessionIdRef.current = created.sessionId;
        await pc.setRemoteDescription(created.sessionDescription);
        const trackObjects = transceivers.map((transceiver) => ({
          location: "local" as const,
          mid: transceiver.mid ?? undefined,
          trackName: transceiver.sender.track?.id ?? crypto.randomUUID(),
        }));
        const publishOffer = await pc.createOffer();
        await pc.setLocalDescription(publishOffer);
        const published = await jsonRequest<{
          sessionDescription?: CloudflareSessionDescription;
        }>(`/api/calls/${encodeURIComponent(callId)}/media/tracks`, {
          method: "POST",
          body: JSON.stringify({
            sessionId: created.sessionId,
            sessionDescription: pc.localDescription,
            tracks: trackObjects,
          }),
        });
        if (published.sessionDescription) {
          await pc.setRemoteDescription(published.sessionDescription);
        }
        await jsonRequest("/api/calls", {
          method: "PATCH",
          body: JSON.stringify({ callId, action: "active", deviceId }),
        });
        setPhase("connected");
      } catch (connectError) {
        closeMedia();
        setPhase("failed");
        setError(connectError instanceof Error ? connectError.message : "Could not join the call.");
      }
    },
    [callId, closeMedia, params.call?.videoEnabled, phase],
  );

  const reconnect = useCallback(async () => {
    closeMedia();
    await jsonRequest("/api/calls", {
      method: "PATCH",
      body: JSON.stringify({ callId, action: "reconnecting", deviceId: deviceIdRef.current }),
    });
    await connect();
  }, [callId, closeMedia, connect]);

  const end = useCallback(async () => {
    if (!callId || endingRef.current) return;
    endingRef.current = true;
    closeMedia();
    setPhase("ended");
    try {
      await jsonRequest("/api/calls", {
        method: "PATCH",
        body: JSON.stringify({ callId, action: "ended", deviceId: deviceIdRef.current }),
      });
    } finally {
      onEnded?.();
    }
  }, [callId, closeMedia, onEnded]);

  const toggleMute = useCallback(() => {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, [localStream]);

  const toggleCamera = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const existing = localStream?.getVideoTracks()[0];
    if (existing) {
      existing.enabled = !existing.enabled;
      setCameraOn(existing.enabled);
      return;
    }
    const video = await navigator.mediaDevices.getUserMedia({
      video: getVideoConstraints(params.call?.entitlements?.maxVideoQuality),
    });
    const track = video.getVideoTracks()[0];
    const sender = pc.getSenders().find((item) => item.track?.kind === "video");
    if (sender) {
      await sender.replaceTrack(track);
    } else {
      const transceiver = pc.addTransceiver(track, { direction: "sendonly", streams: [video] });
      const sessionId = sessionIdRef.current;
      if (sessionId && callId) {
        await pc.setLocalDescription(await pc.createOffer());
        const published = await jsonRequest<{
          sessionDescription?: CloudflareSessionDescription;
        }>(`/api/calls/${encodeURIComponent(callId)}/media/tracks`, {
          method: "POST",
          body: JSON.stringify({
            sessionId,
            sessionDescription: pc.localDescription,
            tracks: [
              {
                location: "local",
                mid: transceiver.mid,
                trackName: track.id,
              },
            ],
          }),
        });
        if (published.sessionDescription) {
          await pc.setRemoteDescription(published.sessionDescription);
        }
      }
    }
    localStreamRef.current?.addTrack(track);
    const next = localStreamRef.current
      ? new MediaStream(localStreamRef.current.getTracks())
      : video;
    localStreamRef.current = next;
    setLocalStream(next);
    setCameraOn(true);
  }, [callId, localStream, params.call?.entitlements?.maxVideoQuality]);

  const toggleScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    if (screenSharing) {
      const camera = localStream?.getVideoTracks()[0] ?? null;
      const sender = pc.getSenders().find((item) => item.track?.kind === "video");
      const displayTrack = sender?.track;
      await sender?.replaceTrack(camera);
      if (displayTrack && displayTrack !== camera) displayTrack.stop();
      setScreenSharing(false);
      return;
    }
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = display.getVideoTracks()[0];
    const sender = pc.getSenders().find((item) => item.track?.kind === "video");
    let activeSender = sender;
    if (sender) {
      await sender.replaceTrack(track);
    } else {
      const transceiver = pc.addTransceiver(track, { direction: "sendonly", streams: [display] });
      activeSender = transceiver.sender;
      const sessionId = sessionIdRef.current;
      if (sessionId && callId) {
        await pc.setLocalDescription(await pc.createOffer());
        const published = await jsonRequest<{
          sessionDescription?: CloudflareSessionDescription;
        }>(`/api/calls/${encodeURIComponent(callId)}/media/tracks`, {
          method: "POST",
          body: JSON.stringify({
            sessionId,
            sessionDescription: pc.localDescription,
            tracks: [
              {
                location: "local",
                mid: transceiver.mid,
                trackName: track.id,
              },
            ],
          }),
        });
        if (published.sessionDescription) {
          await pc.setRemoteDescription(published.sessionDescription);
        }
      }
    }
    track.onended = () => {
      void activeSender?.replaceTrack(localStreamRef.current?.getVideoTracks()[0] ?? null);
      setScreenSharing(false);
    };
    setScreenSharing(true);
  }, [callId, localStream, screenSharing]);

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
    const tracks = localStreamRef.current?.getTracks().filter((item) => item !== previous) ?? [];
    const stream = new MediaStream([...tracks, track]);
    localStreamRef.current = stream;
    setLocalStream(stream);
  }, []);

  const switchVideoInput = useCallback(async (videoDeviceId: string) => {
    const pc = pcRef.current;
    if (!pc) return;
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: getVideoConstraints(params.call?.entitlements?.maxVideoQuality, videoDeviceId),
    });
    const track = next.getVideoTracks()[0];
    const sender = pc.getSenders().find((item) => item.track?.kind === "video");
    if (!sender || !track) return;
    const previous = sender.track;
    await sender.replaceTrack(track);
    previous?.stop();
    const tracks = localStreamRef.current?.getTracks().filter((item) => item !== previous) ?? [];
    const stream = new MediaStream([...tracks, track]);
    localStreamRef.current = stream;
    setLocalStream(stream);
    setCameraOn(true);
  }, [params.call?.entitlements?.maxVideoQuality]);

  const playAiVoice = useCallback(
    async (signedUrl: string) => {
      const pc = pcRef.current;
      const sessionId = sessionIdRef.current;
      if (!pc || !sessionId || !callId) throw new Error("Join the call before speaking.");
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error("Could not load the employee voice.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(objectUrl);
      const context = new AudioContext();
      const source = context.createMediaElementSource(audio);
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      source.connect(context.destination);
      const track = destination.stream.getAudioTracks()[0];
      const transceiver = pc.addTransceiver(track, {
        direction: "sendonly",
        streams: [destination.stream],
      });
      setAiSpeaking(true);
      try {
        await pc.setLocalDescription(await pc.createOffer());
        const published = await jsonRequest<{
          sessionDescription?: CloudflareSessionDescription;
        }>(`/api/calls/${encodeURIComponent(callId)}/media/tracks`, {
          method: "POST",
          body: JSON.stringify({
            sessionId,
            sessionDescription: pc.localDescription,
            tracks: [
              {
                location: "local",
                mid: transceiver.mid,
                trackName: `ai-${crypto.randomUUID()}`,
              },
            ],
          }),
        });
        if (published.sessionDescription) {
          await pc.setRemoteDescription(published.sessionDescription);
        }
        await context.resume();
        await audio.play();
        await new Promise<void>((resolve) => {
          const finish = () => resolve();
          aiPlaybackRef.current = { audio, finish };
          audio.onended = finish;
          audio.onerror = finish;
        });
      } finally {
        if (aiPlaybackRef.current?.audio === audio) aiPlaybackRef.current = null;
        setAiSpeaking(false);
        track.stop();
        transceiver.stop();
        await context.close();
        URL.revokeObjectURL(objectUrl);
      }
    },
    [callId],
  );

  const stopAiVoice = useCallback(() => {
    const playback = aiPlaybackRef.current;
    if (!playback) return;
    playback.audio.pause();
    playback.finish();
    aiPlaybackRef.current = null;
    setAiSpeaking(false);
  }, []);

  useEffect(() => {
    if (!callId || phase === "lobby" || phase === "ended") return;
    const interval = window.setInterval(async () => {
      try {
        const call = await jsonRequest<CallSessionSummary>(
          `/api/calls/${encodeURIComponent(callId)}`,
        );
        if (["ended", "cancelled", "declined", "missed", "failed"].includes(call.status)) {
          closeMedia();
          setPhase("ended");
          onEnded?.();
          return;
        }
        await subscribePeerTracks(call);
        if (deviceIdRef.current) {
          await jsonRequest("/api/calls", {
            method: "PATCH",
            body: JSON.stringify({
              callId,
              action: "heartbeat",
              deviceId: deviceIdRef.current,
            }),
          });
        }
      } catch {
        // A later tick handles transient app-state failures; media can continue.
      }
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [callId, closeMedia, onEnded, phase, subscribePeerTracks]);

  useEffect(() => {
    if (phase !== "connected") return;
    const interval = window.setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      const reports = await pc.getStats();
      let lost = 0;
      let received = 0;
      let jitter = 0;
      let rtt = 0;
      let candidateType: "host" | "srflx" | "prflx" | "relay" | "unknown" = "unknown";
      let loudestTrackIdentifier: string | null = null;
      let loudestAudioLevel = 0;
      reports.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "audio") {
          lost += Number(report.packetsLost ?? 0);
          received += Number(report.packetsReceived ?? 0);
          jitter = Math.max(jitter, Number(report.jitter ?? 0) * 1000);
          const audioLevel = Number(report.audioLevel ?? 0);
          if (audioLevel > loudestAudioLevel) {
            loudestAudioLevel = audioLevel;
            loudestTrackIdentifier = String(report.trackIdentifier ?? "");
          }
        }
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          rtt = Math.max(rtt, Number(report.currentRoundTripTime ?? 0) * 1000);
          const candidate = reports.get(report.localCandidateId);
          if (["host", "srflx", "prflx", "relay"].includes(String(candidate?.candidateType))) {
            candidateType = candidate.candidateType;
          }
        }
      });
      const packetLoss = lost + received > 0 ? (lost / (lost + received)) * 100 : 0;
      const level = packetLoss > 8 || rtt > 600 ? "poor" : packetLoss > 3 || rtt > 300 ? "fair" : "good";
      setQuality({ packetLoss, jitterMs: jitter, roundTripMs: rtt, level });
      const activeParticipant = params.call?.participants.find((participant) =>
        participant.publishedTracks.some(
          (track) => track.trackName === loudestTrackIdentifier,
        ),
      );
      setActiveSpeakerParticipantId(
        loudestAudioLevel > 0.025 ? activeParticipant?.id ?? "remote" : null,
      );
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind !== "video") continue;
        const parameters = sender.getParameters();
        if (!parameters.encodings?.length) parameters.encodings = [{}];
        parameters.encodings[0].maxBitrate =
          level === "poor" ? 250_000 : level === "fair" ? 700_000 : 1_500_000;
        await sender.setParameters(parameters).catch(() => undefined);
      }
      if (callId && Date.now() - lastQualityTelemetryAtRef.current >= 30_000) {
        lastQualityTelemetryAtRef.current = Date.now();
        void jsonRequest(`/api/calls/${encodeURIComponent(callId)}/telemetry`, {
          method: "POST",
          body: JSON.stringify({
            kind: "quality",
            topology: "sfu",
            packetLoss,
            jitterMs: jitter,
            roundTripMs: rtt,
            candidateType,
          }),
        }).catch(() => undefined);
      }
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [callId, params.call?.participants, phase]);

  useEffect(() => {
    if (phase !== "reconnecting") return;
    const timer = window.setTimeout(() => void reconnect(), 4_000);
    return () => window.clearTimeout(timer);
  }, [phase, reconnect]);

  useEffect(() => {
    const recover = () => {
      if (phase === "failed" || phase === "reconnecting") void reconnect();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") recover();
    };
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase, reconnect]);

  useEffect(() => {
    if (phase !== "connected" || !callId) return;
    const interval = window.setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const ice = await jsonRequest<{
          iceServers: RTCIceServer[];
          iceTransportPolicy: RTCIceTransportPolicy;
        }>(
          `/api/calls/turn-credentials?callId=${encodeURIComponent(callId)}&forceRelay=${forceRelayRef.current ? "1" : "0"}`,
        );
        pc.setConfiguration({
          ...pc.getConfiguration(),
          iceServers: ice.iceServers,
          iceTransportPolicy: ice.iceTransportPolicy,
        });
      } catch {
        // Existing credentials remain usable until the next refresh.
      }
    }, 45 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [callId, phase]);

  useEffect(() => () => closeMedia(), [closeMedia]);

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
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    switchAudioInput,
    switchVideoInput,
    playAiVoice,
    stopAiVoice,
  };
}
