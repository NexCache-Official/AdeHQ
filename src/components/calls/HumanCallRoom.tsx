"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Camera,
  CameraOff,
  CheckCircle2,
  Circle,
  Download,
  FileText,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { authHeaders } from "@/lib/api/auth-client";
import type {
  AiParticipationMode,
  CallArtifactType,
  CallSessionSummary,
} from "@/lib/calls/types";
import type { AIEmployee, WorkspaceMember } from "@/lib/types";
import { useHumanCallMedia } from "@/hooks/useHumanCallMedia";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

type Artifact = {
  id: string;
  artifact_type: CallArtifactType;
  title: string;
  content: string;
  visibility: "private" | "shared";
};

type Consent = {
  user_id: string;
  consent_type: "ai_listening" | "transcription" | "recording";
  granted: boolean;
  retention_policy: string | null;
};

type Recording = {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  retentionExpiresAt: string | null;
  downloadUrl: string | null;
};

export function HumanCallRoom({
  initialCall,
  userId,
  members,
  employees,
  onEnd,
}: {
  initialCall: CallSessionSummary;
  userId: string;
  members: WorkspaceMember[];
  employees: AIEmployee[];
  onEnd: () => void;
}) {
  const [call, setCall] = useState(initialCall);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [forceRelay, setForceRelay] = useState(false);
  const [workOpen, setWorkOpen] = useState(true);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [artifactTitle, setArtifactTitle] = useState("");
  const [artifactType, setArtifactType] = useState<CallArtifactType>("decision");
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [aiMode, setAiMode] = useState<AiParticipationMode>("on_request");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiReply, setAiReply] = useState("");
  const [aiTurnId, setAiTurnId] = useState<string | null>(null);
  const [sidecarArtifactId, setSidecarArtifactId] = useState<string | null>(null);
  const [aiWorkHours, setAiWorkHours] = useState<number | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [delegating, setDelegating] = useState(false);
  const [councilBusy, setCouncilBusy] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [aiConsented, setAiConsented] = useState(false);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [retentionPolicy, setRetentionPolicy] = useState("workspace_default");
  const [recording, setRecording] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const pushToTalkRef = useRef<MediaRecorder | null>(null);
  const pushToTalkChunksRef = useRef<Blob[]>([]);
  const interruptedTurnsRef = useRef(new Set<string>());
  const autoRejoinedRef = useRef(false);
  const media = useHumanCallMedia({ call, userId, onEnded: onEnd });

  useEffect(() => {
    void navigator.mediaDevices
      .enumerateDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = media.localStream;
  }, [media.localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = media.remoteStream;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = media.remoteStream;
  }, [media.remoteStream]);

  useEffect(() => {
    if (media.phase === "lobby" || media.phase === "ended") return;
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/calls/${encodeURIComponent(call.id)}`, {
          headers: await authHeaders(call.workspaceId),
          cache: "no-store",
        });
        if (response.ok) setCall((await response.json()) as CallSessionSummary);
      } catch {
        // Media remains authoritative while app-state polling recovers.
      }
    }, 2_500);
    return () => window.clearInterval(interval);
  }, [call.id, call.workspaceId, media.phase]);

  useEffect(() => {
    if (
      autoRejoinedRef.current ||
      media.phase !== "lobby" ||
      !["active", "reconnecting", "connecting"].includes(call.status)
    ) {
      return;
    }
    const currentDeviceId = localStorage.getItem("adehq.call.device-id.v1");
    const participant = call.participants.find((item) => item.userId === userId);
    if (!currentDeviceId || participant?.deviceId !== currentDeviceId) return;
    autoRejoinedRef.current = true;
    void media.connect();
  }, [call.participants, call.status, media.connect, media.phase, userId]);

  async function loadArtifacts() {
    const response = await fetch(`/api/calls/${encodeURIComponent(call.id)}/artifacts`, {
      headers: await authHeaders(call.workspaceId),
      cache: "no-store",
    });
    if (response.ok) {
      const body = (await response.json()) as { artifacts?: Artifact[] };
      setArtifacts(body.artifacts ?? []);
    }
  }

  async function loadConsents() {
    const response = await fetch(`/api/calls/${encodeURIComponent(call.id)}/consents`, {
      headers: await authHeaders(call.workspaceId),
      cache: "no-store",
    });
    if (!response.ok) return;
    const body = (await response.json()) as { consents?: Consent[] };
    const next = body.consents ?? [];
    setConsents(next);
    setAiConsented(
      next.some(
        (consent) =>
          consent.user_id === userId &&
          consent.consent_type === "ai_listening" &&
          consent.granted,
      ),
    );
  }

  async function loadRecordings() {
    const response = await fetch(`/api/calls/${encodeURIComponent(call.id)}/recordings`, {
      headers: await authHeaders(call.workspaceId),
      cache: "no-store",
    });
    if (!response.ok) return;
    const body = (await response.json()) as { recordings?: Recording[] };
    setRecordings(body.recordings ?? []);
  }

  useEffect(() => {
    void loadArtifacts();
    void loadConsents();
    void loadRecordings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.id]);

  async function addArtifact() {
    if (!artifactTitle.trim()) return;
    const response = await fetch(`/api/calls/${encodeURIComponent(call.id)}/artifacts`, {
      method: "POST",
      headers: await authHeaders(call.workspaceId),
      body: JSON.stringify({ type: artifactType, title: artifactTitle, visibility: "shared" }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setNotice(body.error || "Could not add call work.");
      return;
    }
    setArtifactTitle("");
    await loadArtifacts();
  }

  async function saveConsent(
    granted: boolean,
    consentType: "ai_listening" | "transcription" | "recording" = "ai_listening",
  ) {
    const response = await fetch(`/api/calls/${encodeURIComponent(call.id)}/consents`, {
      method: "POST",
      headers: await authHeaders(call.workspaceId),
      body: JSON.stringify({
        consentType,
        granted,
        retentionPolicy,
      }),
    });
    if (!response.ok) throw new Error("Could not save AI consent.");
    if (consentType === "ai_listening") setAiConsented(granted);
    await loadConsents();
  }

  async function uploadTranscriptChunk(blob: Blob) {
    if (blob.size < 1_000) return null;
    const headers = new Headers(await authHeaders(call.workspaceId));
    headers.delete("Content-Type");
    const form = new FormData();
    form.set("file", new File([blob], `call-${Date.now()}.webm`, { type: blob.type }));
    form.set("durationSeconds", "15");
    const response = await fetch(`/api/calls/${encodeURIComponent(call.id)}/transcribe`, {
      method: "POST",
      headers,
      body: form,
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      transcript?: string;
    };
    if (!response.ok) {
      setNotice(body.error || "Transcription paused.");
      return null;
    }
    if (body.transcript) {
      setLiveTranscript((current) => `${current}${current ? " " : ""}${body.transcript}`);
      await loadArtifacts();
    }
    return body.transcript ?? null;
  }

  async function toggleTranscription() {
    if (transcribing) {
      recorderRef.current?.stop();
      recorderRef.current = null;
      setTranscribing(false);
      return;
    }
    const tracks = [
      ...(media.localStream?.getAudioTracks() ?? []),
      ...(media.remoteStream?.getAudioTracks() ?? []),
    ];
    if (!tracks.length) {
      setNotice("Join audio before starting transcription.");
      return;
    }
    try {
      await saveConsent(true, "transcription");
      const stream = new MediaStream(tracks);
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      recorder.ondataavailable = (event) => void uploadTranscriptChunk(event.data);
      recorder.onerror = () => {
        setTranscribing(false);
        setNotice("Live transcription stopped after a browser media error.");
      };
      recorder.start(15_000);
      recorderRef.current = recorder;
      setTranscribing(true);
    } catch (transcriptionError) {
      setNotice(
        transcriptionError instanceof Error
          ? transcriptionError.message
          : "Could not start transcription.",
      );
    }
  }

  async function toggleRecordingConsent() {
    const ownConsent = consents.some(
      (consent) =>
        consent.user_id === userId && consent.consent_type === "recording" && consent.granted,
    );
    await saveConsent(!ownConsent, "recording");
  }

  async function uploadRecording(blob: Blob) {
    const headers = new Headers(await authHeaders(call.workspaceId));
    headers.delete("Content-Type");
    const form = new FormData();
    form.set("file", new File([blob], `call-${call.id}.webm`, { type: blob.type }));
    form.set("retentionPolicy", retentionPolicy);
    const response = await fetch(`/api/calls/${encodeURIComponent(call.id)}/recordings`, {
      method: "POST",
      headers,
      body: form,
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(body.error || "Could not save recording.");
    await loadRecordings();
  }

  async function toggleRecording() {
    if (recording) {
      recordingRef.current?.stop();
      return;
    }
    if (media.topology === "p2p") {
      media.migrateToSfu();
      setNotice("Moving this call to the SFU before recording. Start recording again once connected.");
      return;
    }
    const tracks = [
      ...(media.localStream?.getTracks() ?? []),
      ...(media.remoteStream?.getTracks() ?? []),
    ];
    if (!tracks.length) {
      setNotice("Join media before recording.");
      return;
    }
    const recordingConsentCount = humanParticipants.filter((participant) =>
      consents.some(
        (consent) =>
          consent.user_id === participant.userId &&
          consent.consent_type === "recording" &&
          consent.granted,
      ),
    ).length;
    if (recordingConsentCount !== humanParticipants.length) {
      setNotice("Every human participant must consent before recording starts.");
      return;
    }
    const hasVideo = tracks.some((track) => track.kind === "video");
    const mimeType = hasVideo && MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : hasVideo && MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
    const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType });
    recordingChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType });
      recordingChunksRef.current = [];
      recordingRef.current = null;
      setRecording(false);
      void uploadRecording(blob).catch((recordingError) =>
        setNotice(
          recordingError instanceof Error ? recordingError.message : "Could not save recording.",
        ),
      );
    };
    recorder.onerror = () => {
      recordingRef.current = null;
      setRecording(false);
      setNotice("Recording stopped after a browser media error.");
    };
    recorder.start(5_000);
    recordingRef.current = recorder;
    setRecording(true);
  }

  async function deleteRecording(artifactId: string) {
    const response = await fetch(
      `/api/calls/${encodeURIComponent(call.id)}/recordings?artifactId=${encodeURIComponent(artifactId)}`,
      {
        method: "DELETE",
        headers: await authHeaders(call.workspaceId),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setNotice(body.error || "Could not delete recording.");
      return;
    }
    await loadRecordings();
  }

  async function inviteAi() {
    if (!selectedEmployeeId) return;
    if (!aiConsented) {
      setNotice("Grant AI listening consent before inviting an employee.");
      return;
    }
    const response = await fetch(`/api/calls/${encodeURIComponent(call.id)}/ai`, {
      method: "POST",
      headers: await authHeaders(call.workspaceId),
      body: JSON.stringify({ roomId: call.roomId, employeeId: selectedEmployeeId, mode: aiMode }),
    });
    const body = (await response.json().catch(() => ({}))) as CallSessionSummary & {
      error?: string;
    };
    if (!response.ok) {
      setNotice(body.error || "Could not invite employee.");
      return;
    }
    setCall(body);
    setAiOpen(false);
  }

  async function generateOutcomes() {
    const employeeId = selectedEmployeeId || invitedEmployees[0]?.employeeId;
    if (!employeeId) {
      setNotice("Invite an AI employee before generating call outcomes.");
      return;
    }
    setSummarizing(true);
    try {
      const response = await fetch(
        `/api/calls/${encodeURIComponent(call.id)}/ai/summary`,
        {
          method: "POST",
          headers: await authHeaders(call.workspaceId),
          body: JSON.stringify({ employeeId }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        settledWh?: number;
      };
      if (!response.ok) throw new Error(body.error || "Could not generate call outcomes.");
      setAiWorkHours(body.settledWh ?? null);
      await loadArtifacts();
    } catch (summaryError) {
      setNotice(
        summaryError instanceof Error ? summaryError.message : "Could not generate call outcomes.",
      );
    } finally {
      setSummarizing(false);
    }
  }

  async function askAi(
    speak: boolean,
    kind: "request" | "delegation" = "request",
    contentOverride?: string,
  ) {
    const content = contentOverride?.trim() || aiPrompt.trim();
    const employeeId = selectedEmployeeId || invitedEmployees[0]?.employeeId;
    if (!employeeId || !content) return;
    setAiBusy(true);
    setDelegating(kind === "delegation");
    setAiReply("");
    try {
      const response = await fetch(`/api/calls/${encodeURIComponent(call.id)}/ai/turn`, {
        method: "POST",
        headers: await authHeaders(call.workspaceId),
        body: JSON.stringify({
          employeeId,
          content,
          speak,
          privateSidecar: !speak,
          kind,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        turnId?: string;
        reply?: string;
        voice?: { signedUrl?: string };
        sidecarArtifactId?: string | null;
        workHours?: { settled?: number };
      };
      if (!response.ok) throw new Error(body.error || "Employee could not respond.");
      setAiTurnId(body.turnId ?? null);
      setAiReply(body.reply ?? "");
      setSidecarArtifactId(body.sidecarArtifactId ?? null);
      setAiWorkHours(body.workHours?.settled ?? null);
      setAiPrompt("");
      if (speak && body.voice?.signedUrl && body.turnId) {
        await media.playAiVoice(body.voice.signedUrl);
        if (!interruptedTurnsRef.current.delete(body.turnId)) {
          await fetch(
            `/api/calls/${encodeURIComponent(call.id)}/ai/turn?turnId=${encodeURIComponent(body.turnId)}`,
            {
              method: "PATCH",
              headers: await authHeaders(call.workspaceId),
              body: JSON.stringify({ action: "completed" }),
            },
          );
        }
        setAiTurnId(null);
      }
      await loadArtifacts();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Employee could not respond.");
    } finally {
      setAiBusy(false);
      setDelegating(false);
    }
  }

  async function startPushToTalk() {
    const track = media.localStream?.getAudioTracks()[0];
    if (!track || pushToTalkRef.current) {
      setNotice("Join audio before using push-to-talk.");
      return;
    }
    await saveConsent(true, "transcription");
    const recorder = new MediaRecorder(new MediaStream([track.clone()]), {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    });
    pushToTalkChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) pushToTalkChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      recorder.stream.getTracks().forEach((item) => item.stop());
      const blob = new Blob(pushToTalkChunksRef.current, { type: recorder.mimeType });
      pushToTalkChunksRef.current = [];
      pushToTalkRef.current = null;
      setPushToTalk(false);
      void uploadTranscriptChunk(blob).then((transcript) => {
        if (transcript) void askAi(true, "request", transcript);
      });
    };
    recorder.start();
    pushToTalkRef.current = recorder;
    setPushToTalk(true);
  }

  function stopPushToTalk() {
    if (pushToTalkRef.current?.state === "recording") pushToTalkRef.current.stop();
  }

  async function stopAiSpeaking() {
    if (!aiTurnId) return;
    interruptedTurnsRef.current.add(aiTurnId);
    media.stopAiVoice();
    await fetch(
      `/api/calls/${encodeURIComponent(call.id)}/ai/turn?turnId=${encodeURIComponent(aiTurnId)}`,
      {
        method: "PATCH",
        headers: await authHeaders(call.workspaceId),
        body: JSON.stringify({ action: "interrupted" }),
      },
    );
    setAiTurnId(null);
  }

  async function runCouncil() {
    if (invitedEmployees.length < 2 || !aiPrompt.trim()) return;
    setCouncilBusy(true);
    try {
      const response = await fetch(
        `/api/calls/${encodeURIComponent(call.id)}/ai/council`,
        {
          method: "POST",
          headers: await authHeaders(call.workspaceId),
          body: JSON.stringify({
            employeeIds: invitedEmployees.map((participant) => participant.employeeId),
            question: aiPrompt,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        reply?: string;
        settledWh?: number;
      };
      if (!response.ok) throw new Error(body.error || "The expert council could not finish.");
      setAiReply(body.reply ?? "");
      setAiWorkHours(body.settledWh ?? null);
      setAiPrompt("");
      await loadArtifacts();
    } catch (councilError) {
      setNotice(
        councilError instanceof Error ? councilError.message : "The expert council could not finish.",
      );
    } finally {
      setCouncilBusy(false);
    }
  }

  async function resolveSidecar(action: "share" | "keep" | "ignore" | "ask") {
    if (action === "ask") {
      setAiPrompt(`Share this finding with the call: ${aiReply}`);
      return;
    }
    if (sidecarArtifactId && action !== "keep") {
      await fetch(
        `/api/calls/${encodeURIComponent(call.id)}/artifacts?artifactId=${encodeURIComponent(sidecarArtifactId)}`,
        {
          method: action === "share" ? "PATCH" : "DELETE",
          headers: await authHeaders(call.workspaceId),
        },
      );
    }
    setAiReply("");
    setSidecarArtifactId(null);
    await loadArtifacts();
  }

  const participantName = (participant: CallSessionSummary["participants"][number]) => {
    if (participant.userId) {
      return members.find((member) => member.userId === participant.userId)?.name ?? "Workspace member";
    }
    return employees.find((employee) => employee.id === participant.employeeId)?.name ?? "AI employee";
  };
  const joined = call.participants.filter((participant) =>
    ["accepted", "joining", "joined"].includes(participant.state),
  );
  const invitedEmployees = call.participants.filter(
    (participant) => participant.participantType === "ai_employee",
  );
  const activeEmployeeId = selectedEmployeeId || invitedEmployees[0]?.employeeId || "";
  const activeSpeaker =
    call.participants.find(
      (participant) => participant.id === media.activeSpeakerParticipantId,
    ) ??
    (media.activeSpeakerParticipantId === "remote"
      ? call.participants.find((participant) => participant.userId !== userId)
      : undefined);
  const humanParticipants = call.participants.filter((participant) => participant.userId);
  const aiConsentCount = humanParticipants.filter((participant) =>
    consents.some(
      (consent) =>
        consent.user_id === participant.userId &&
        consent.consent_type === "ai_listening" &&
        consent.granted,
    ),
  ).length;
  const recordingConsentCount = humanParticipants.filter((participant) =>
    consents.some(
      (consent) =>
        consent.user_id === participant.userId &&
        consent.consent_type === "recording" &&
        consent.granted,
    ),
  ).length;
  const ownRecordingConsent = consents.some(
    (consent) =>
      consent.user_id === userId && consent.consent_type === "recording" && consent.granted,
  );

  useEffect(
    () => () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      if (recordingRef.current?.state === "recording") recordingRef.current.stop();
      if (pushToTalkRef.current?.state === "recording") pushToTalkRef.current.stop();
    },
    [],
  );

  if (media.phase === "lobby") {
    return (
      <div className="flex h-full items-center justify-center bg-canvas px-5">
        <section className="w-full max-w-xl">
          <div className="flex items-center gap-3 border-b border-border pb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-3">
                Private SFU call
              </p>
              <h1 className="truncate text-xl font-semibold text-ink">{call.title}</h1>
            </div>
          </div>
          <div className="grid gap-4 py-6 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-ink-3">Microphone</span>
              <select
                className="input-field"
                value={audioDeviceId}
                onChange={(event) => setAudioDeviceId(event.target.value)}
              >
                <option value="">System default</option>
                {devices
                  .filter((device) => device.kind === "audioinput")
                  .map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || "Microphone"}
                    </option>
                  ))}
              </select>
            </label>
            {call.entitlements?.videoEnabled ? (
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-ink-3">Camera</span>
                <select
                  className="input-field"
                  value={videoDeviceId}
                  onChange={(event) => setVideoDeviceId(event.target.value)}
                >
                  <option value="">System default</option>
                  {devices
                    .filter((device) => device.kind === "videoinput")
                    .map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || "Camera"}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
          </div>
          <p className="text-sm leading-relaxed text-ink-3">
            Human media is included and does not use Work Hours. AI participation is visibly
            consented and metered separately.
          </p>
          {call.entitlements?.forceRelayAvailable ? (
            <label className="mt-4 flex items-start gap-3 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={forceRelay}
                onChange={(event) => setForceRelay(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Force relay
                <span className="mt-0.5 block text-xs text-ink-3">
                  Hide peer network addresses. SFU transport is encrypted, but this is not
                  participant-to-participant E2EE.
                </span>
              </span>
            </label>
          ) : null}
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="ghost" onClick={onEnd}>Leave</Button>
            <Button
              onClick={() => void media.connect({ audioDeviceId, videoDeviceId, forceRelay })}
            >
              <Mic className="h-4 w-4" /> {call.videoEnabled ? "Join video" : "Join audio"}
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[#10151c] text-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{call.title}</h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/55">
              {media.quality.level === "poor" ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
              {media.phase} · {media.topology.toUpperCase()} · {joined.length} present · {media.quality.roundTripMs.toFixed(0)} ms
              {activeSpeaker ? ` · ${participantName(activeSpeaker)} speaking` : ""}
            </p>
          </div>
          <div className="flex max-w-[70%] items-center gap-2 overflow-x-auto">
            {recording ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-red-300">
                <Circle className="h-2.5 w-2.5 fill-current" /> Recording
              </span>
            ) : null}
            <Button
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => {
                if (media.topology === "p2p") media.migrateToSfu();
                setAiOpen(true);
              }}
            >
              <Bot className="h-4 w-4" /> Invite AI
            </Button>
            <Button
              variant="ghost"
              className={cn(
                "text-white hover:bg-white/10 hover:text-white",
                transcribing && "bg-white/10",
              )}
              onClick={() => void toggleTranscription()}
            >
              <FileText className="h-4 w-4" /> {transcribing ? "Stop transcript" : "Transcript"}
            </Button>
            <Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setWorkOpen((value) => !value)}>
              <FileText className="h-4 w-4" /> Work
            </Button>
            {call.entitlements?.recordingEnabled ? (
              <Button
                variant={recording ? "danger" : "ghost"}
                className={recording ? "" : "text-white hover:bg-white/10 hover:text-white"}
                onClick={() => void toggleRecording()}
              >
                <Circle className={cn("h-3.5 w-3.5", recording && "fill-current")} />
                {recording ? "Stop" : "Record"}
              </Button>
            ) : null}
          </div>
        </header>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <audio ref={remoteAudioRef} autoPlay />
          <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
          {!media.remoteStream?.getVideoTracks().length ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_35%,#263647_0%,#10151c_68%)]">
              <div className="text-center">
                <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[28px] bg-white/10">
                  <Users className="h-10 w-10 text-white/70" />
                </div>
                <p className="mt-4 text-lg font-medium">
                  {joined.filter((participant) => participant.userId !== userId).map(participantName).join(", ") || "Waiting for others"}
                </p>
                <p className="mt-1 text-sm text-white/45">Audio is connected through Cloudflare Realtime</p>
              </div>
            </div>
          ) : null}
          {media.localStream?.getVideoTracks().length ? (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="absolute bottom-5 right-5 h-36 w-52 rounded-xl border border-white/20 bg-black object-cover shadow-xl"
            />
          ) : null}
          {media.phase === "failed" ? (
            <div className="absolute inset-x-0 top-5 mx-auto flex w-fit items-center gap-3 rounded-xl bg-danger px-4 py-3 text-sm">
              {media.error}
              <button onClick={() => void media.reconnect()} className="font-semibold underline">
                Reconnect
              </button>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-center gap-3 border-t border-white/10 px-4 py-4">
          <button
            type="button"
            aria-label={media.muted ? "Unmute" : "Mute"}
            onClick={media.toggleMute}
            className={cn("flex h-11 w-11 items-center justify-center rounded-xl transition", media.muted ? "bg-danger" : "bg-white/10 hover:bg-white/15")}
          >
            {media.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          {call.videoEnabled ? (
            <button
              type="button"
              aria-label={media.cameraOn ? "Turn camera off" : "Turn camera on"}
              onClick={() => void media.toggleCamera()}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 transition hover:bg-white/15"
            >
              {media.cameraOn ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
            </button>
          ) : null}
          {call.entitlements?.screenShareEnabled ? (
            <button
              type="button"
              aria-label="Share screen"
              onClick={() => {
                if (media.topology === "p2p") {
                  media.migrateToSfu();
                  setNotice("Moving this call to the SFU. Share your screen once reconnected.");
                  return;
                }
                void media.toggleScreenShare();
              }}
              className={cn("flex h-11 w-11 items-center justify-center rounded-xl transition", media.screenSharing ? "bg-accent" : "bg-white/10 hover:bg-white/15")}
            >
              <MonitorUp className="h-5 w-5" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="End call"
            onClick={() => void media.end()}
            className="ml-3 flex h-11 items-center gap-2 rounded-xl bg-danger px-5 font-medium transition hover:brightness-110"
          >
            <PhoneOff className="h-5 w-5" /> End
          </button>
        </footer>
      </div>

      {workOpen ? (
        <aside className="fixed inset-x-0 bottom-0 z-30 flex h-[58vh] flex-col border-t border-white/10 bg-[#151c25] lg:static lg:h-auto lg:w-[340px] lg:shrink-0 lg:border-l lg:border-t-0">
          <div className="border-b border-white/10 px-5 py-4">
            <h2 className="text-sm font-semibold">Call work</h2>
            <p className="mt-1 text-xs text-white/45">Decisions and actions stay linked to this call.</p>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {artifacts.map((artifact) => (
              <div key={artifact.id} className="border-b border-white/10 pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{artifact.artifact_type}</p>
                <p className="mt-1 text-sm">{artifact.title}</p>
                {artifact.content ? <p className="mt-1 text-xs leading-relaxed text-white/55">{artifact.content}</p> : null}
              </div>
            ))}
            {!artifacts.length ? <p className="py-8 text-center text-sm text-white/40">No call outcomes yet.</p> : null}
            {aiReply ? (
              <div className="border-l-2 border-accent pl-3">
                <p className="text-xs font-semibold text-accent">Private AI sidecar</p>
                <p className="mt-1 text-sm leading-relaxed text-white/70">{aiReply}</p>
                {aiWorkHours !== null ? (
                  <p className="mt-1 text-[11px] text-white/40">
                    {aiWorkHours.toFixed(3)} Work Hours settled
                  </p>
                ) : null}
                {sidecarArtifactId ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <button type="button" onClick={() => void resolveSidecar("ask")} className="text-accent hover:underline">Ask aloud</button>
                    <button type="button" onClick={() => void resolveSidecar("share")} className="text-accent hover:underline">Show everyone</button>
                    <button type="button" onClick={() => void resolveSidecar("keep")} className="text-white/55 hover:text-white">Keep private</button>
                    <button type="button" onClick={() => void resolveSidecar("ignore")} className="text-white/55 hover:text-white">Ignore</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {liveTranscript ? (
              <div className="border-l-2 border-white/20 pl-3">
                <p className="text-xs font-semibold text-white/50">Live transcript</p>
                <p className="mt-1 text-sm leading-relaxed text-white/70">{liveTranscript}</p>
              </div>
            ) : null}
            {recordings.map((item) => (
              <div key={item.id} className="border-l-2 border-red-300/50 pl-3">
                <p className="text-xs font-semibold text-white/60">{item.title}</p>
                <p className="mt-1 text-[11px] text-white/40">
                  {item.retentionExpiresAt
                    ? `Retained until ${new Date(item.retentionExpiresAt).toLocaleDateString()}`
                    : "Workspace retention"}
                </p>
                <div className="mt-2 flex gap-3 text-[11px]">
                  {item.downloadUrl ? (
                    <a href={item.downloadUrl} download className="inline-flex items-center gap-1 text-accent hover:underline">
                      <Download className="h-3 w-3" /> Download
                    </a>
                  ) : null}
                  <button type="button" onClick={() => void deleteRecording(item.id)} className="inline-flex items-center gap-1 text-white/45 hover:text-red-300">
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-3 border-t border-white/10 p-4">
            {call.entitlements?.recordingEnabled ? (
              <div className="space-y-2 border-b border-white/10 pb-3">
                <button
                  type="button"
                  onClick={() => void toggleRecordingConsent()}
                  className="flex w-full items-start gap-2 text-left"
                >
                  <CheckCircle2 className={cn("mt-0.5 h-4 w-4", ownRecordingConsent ? "text-success" : "text-white/35")} />
                  <span className="text-xs text-white/65">
                    {ownRecordingConsent ? "Recording consent granted" : "Grant recording consent"}
                    <span className="mt-0.5 block text-[11px] text-white/40">
                      {recordingConsentCount}/{humanParticipants.length} people consented
                    </span>
                  </span>
                </button>
                <select
                  className="input-field"
                  aria-label="Recording retention"
                  value={retentionPolicy}
                  onChange={(event) => setRetentionPolicy(event.target.value)}
                >
                  <option value="session_only">Delete after call</option>
                  <option value="30_days">Keep for 30 days</option>
                  <option value="workspace_default">Workspace default</option>
                </select>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Microphone
                </span>
                <select
                  className="input-field"
                  value={audioDeviceId}
                  onChange={(event) => {
                    const id = event.target.value;
                    setAudioDeviceId(id);
                    if (id) void media.switchAudioInput(id);
                  }}
                >
                  <option value="">System default</option>
                  {devices.filter((device) => device.kind === "audioinput").map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || "Microphone"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Camera
                </span>
                <select
                  className="input-field"
                  value={videoDeviceId}
                  onChange={(event) => {
                    const id = event.target.value;
                    setVideoDeviceId(id);
                    if (id) void media.switchVideoInput(id);
                  }}
                >
                  <option value="">System default</option>
                  {devices.filter((device) => device.kind === "videoinput").map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || "Camera"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {invitedEmployees.length ? (
              <>
                <select className="input-field" value={activeEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
                  {invitedEmployees.map((participant) => (
                    <option key={participant.id} value={participant.employeeId ?? ""}>{participantName(participant)}</option>
                  ))}
                </select>
                <textarea
                  className="input-field min-h-20 resize-none"
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  placeholder="Ask privately or invite a spoken response…"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10" disabled={aiBusy} onClick={() => void askAi(false)}>
                    <Sparkles className="h-4 w-4" /> Sidecar
                  </Button>
                  <Button disabled={aiBusy} onClick={() => void askAi(true)}>
                    {aiBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />} Ask aloud
                  </Button>
                </div>
                <Button
                  variant={pushToTalk ? "danger" : "outline"}
                  className={pushToTalk ? "w-full" : "w-full border-white/15 bg-transparent text-white hover:bg-white/10"}
                  disabled={aiBusy || !activeEmployeeId}
                  onPointerDown={() => void startPushToTalk()}
                  onPointerUp={stopPushToTalk}
                  onPointerCancel={stopPushToTalk}
                  onPointerLeave={stopPushToTalk}
                >
                  <Mic className="h-4 w-4" />
                  {pushToTalk ? "Release to ask aloud" : "Hold to ask aloud"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full border-white/15 bg-transparent text-white hover:bg-white/10"
                  disabled={aiBusy}
                  onClick={() => void askAi(false, "delegation")}
                >
                  {delegating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                  {delegating ? "Working in background…" : "Delegate while we talk"}
                </Button>
                {invitedEmployees.length > 1 ? (
                  <Button
                    variant="outline"
                    className="w-full border-white/15 bg-transparent text-white hover:bg-white/10"
                    disabled={councilBusy || !aiPrompt.trim()}
                    onClick={() => void runCouncil()}
                  >
                    {councilBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                    Ask expert council
                  </Button>
                ) : null}
                {media.aiSpeaking ? (
                  <Button variant="danger" onClick={() => void stopAiSpeaking()}>
                    <MicOff className="h-4 w-4" /> Stop AI speaker
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="border-white/15 bg-transparent text-white hover:bg-white/10"
                  disabled={summarizing || !liveTranscript}
                  onClick={() => void generateOutcomes()}
                >
                  {summarizing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Summarize into work
                </Button>
              </>
            ) : null}
            <div className="flex gap-2">
              <select className="input-field w-28" value={artifactType} onChange={(event) => setArtifactType(event.target.value as CallArtifactType)}>
                <option value="decision">Decision</option>
                <option value="task">Task</option>
                <option value="question">Question</option>
                <option value="risk">Risk</option>
                <option value="note">Note</option>
              </select>
              <input className="input-field min-w-0 flex-1" value={artifactTitle} onChange={(event) => setArtifactTitle(event.target.value)} placeholder="Capture outcome" onKeyDown={(event) => event.key === "Enter" && void addArtifact()} />
              <Button size="icon" onClick={() => void addArtifact()} aria-label="Add call outcome"><Plus className="h-4 w-4" /></Button>
            </div>
          </div>
        </aside>
      ) : null}

      <Modal open={aiOpen} onClose={() => setAiOpen(false)} size="md">
        <ModalHeader title="Invite an AI employee" subtitle="Default: responds only when explicitly asked." onClose={() => setAiOpen(false)} icon={<Bot className="h-5 w-5" />} />
        <div className="space-y-5 p-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Employee</span>
            <select className="input-field" value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
              <option value="">Choose a hired employee</option>
              {employees.filter((employee) => !employee.isSystemEmployee && employee.systemEmployeeKey !== "maya").map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name} — {employee.role}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Transcript and AI retention</span>
            <select
              className="input-field"
              value={retentionPolicy}
              onChange={(event) => setRetentionPolicy(event.target.value)}
            >
              <option value="session_only">Delete after the call</option>
              <option value="30_days">Keep for 30 days</option>
              <option value="workspace_default">Workspace default</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Participation mode</span>
            <select className="input-field" value={aiMode} onChange={(event) => setAiMode(event.target.value as AiParticipationMode)}>
              <option value="silent_observer">Silent observer</option>
              <option value="on_request">On request (recommended)</option>
              <option value="advisor">Advisor</option>
              <option value="facilitator">Facilitator</option>
              <option value="active">Active participant</option>
            </select>
          </label>
          <button
            type="button"
            role="checkbox"
            aria-checked={aiConsented}
            onClick={() => void saveConsent(!aiConsented)}
            className="flex w-full items-start gap-3 border-y border-border py-4 text-left"
          >
            <CheckCircle2 className={cn("mt-0.5 h-5 w-5", aiConsented ? "text-success" : "text-ink-3")} />
            <span>
              <span className="block text-sm font-medium text-ink">I consent to AI assistance</span>
              <span className="mt-1 block text-xs leading-relaxed text-ink-3">
                AI presence is visible. Context stays scoped to this room. AI work uses Work
                Hours. {aiConsentCount}/{humanParticipants.length} people have consented.
              </span>
            </span>
          </button>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={() => setAiOpen(false)}>Cancel</Button>
          <Button onClick={() => void inviteAi()} disabled={!selectedEmployeeId || !aiConsented}>Invite employee</Button>
        </div>
      </Modal>

      <Modal open={Boolean(notice)} onClose={() => setNotice(null)} size="sm">
        <div className="p-6">
          <h2 className="text-base font-semibold text-ink">Call update</h2>
          <p className="mt-2 text-sm text-ink-3">{notice}</p>
          <div className="mt-5 flex justify-end"><Button onClick={() => setNotice(null)}>OK</Button></div>
        </div>
      </Modal>
    </div>
  );
}
