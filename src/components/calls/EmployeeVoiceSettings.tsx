"use client";

import { useEffect, useMemo, useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { cn } from "@/lib/utils";

const FEMALE_VOICES = [
  { id: "eve", label: "Eve" },
  { id: "ara", label: "Ara" },
] as const;

const MALE_VOICES = [
  { id: "leo", label: "Leo" },
  { id: "rex", label: "Rex" },
  { id: "sal", label: "Sal" },
] as const;

type GenderMode = "auto" | "female" | "male";

type ProfileResponse = {
  employeeName?: string | null;
  profile?: {
    pace?: number;
    genderMode?: GenderMode;
    resolvedGender?: "female" | "male";
    providerBindings?: Array<{
      provider: string;
      voiceId: string;
      qualityTier: string;
    }>;
  };
};

type ProviderBinding = NonNullable<
  NonNullable<ProfileResponse["profile"]>["providerBindings"]
>[number];

export function EmployeeVoiceSettings({
  workspaceId,
  employeeId,
}: {
  workspaceId: string;
  employeeId: string;
}) {
  const [voiceId, setVoiceId] = useState("eve");
  const [pace, setPace] = useState(1);
  const [genderMode, setGenderMode] = useState<GenderMode>("auto");
  const [resolvedGender, setResolvedGender] = useState<"female" | "male">("female");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [providerBindings, setProviderBindings] = useState<ProviderBinding[]>([]);
  const [employeeName, setEmployeeName] = useState<string | null>(null);

  const voiceOptions = useMemo(
    () => (resolvedGender === "female" ? FEMALE_VOICES : MALE_VOICES),
    [resolvedGender],
  );

  useEffect(() => {
    if (!workspaceId || !employeeId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/employees/${encodeURIComponent(employeeId)}/voice-profile`,
          { headers: await authHeaders(workspaceId), cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as ProfileResponse;
        const bindings = body.profile?.providerBindings ?? [];
        const binding = bindings.find(
          (candidate) =>
            candidate.provider === "xai" && candidate.qualityTier === "standard",
        );
        if (binding?.voiceId) setVoiceId(binding.voiceId);
        setProviderBindings(bindings);
        if (typeof body.profile?.pace === "number") setPace(body.profile.pace);
        if (body.profile?.genderMode) setGenderMode(body.profile.genderMode);
        if (body.profile?.resolvedGender) {
          setResolvedGender(body.profile.resolvedGender);
        }
        if (body.employeeName) setEmployeeName(body.employeeName);
      } catch {
        // Keep call setup usable when profile loading is temporarily unavailable.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, workspaceId]);

  async function save(input: {
    nextVoiceId?: string;
    nextPace?: number;
    nextGenderMode?: GenderMode;
  }) {
    const nextVoiceId = input.nextVoiceId ?? voiceId;
    const nextPace = input.nextPace ?? pace;
    const nextGenderMode = input.nextGenderMode ?? genderMode;
    setVoiceId(nextVoiceId);
    setPace(nextPace);
    setGenderMode(nextGenderMode);
    setSaving(true);
    try {
      const nextBindings: ProviderBinding[] = [
        ...providerBindings.filter(
          (binding) =>
            !(binding.provider === "xai" && binding.qualityTier === "standard"),
        ),
        {
          provider: "xai",
          voiceId: nextVoiceId,
          qualityTier: "standard",
        },
      ];
      const response = await fetch(
        `/api/employees/${encodeURIComponent(employeeId)}/voice-profile`,
        {
          method: "PATCH",
          headers: await authHeaders(workspaceId),
          body: JSON.stringify({
            pace: nextPace,
            genderMode: nextGenderMode,
            providerBindings: nextBindings,
          }),
        },
      );
      if (!response.ok) return;
      const body = (await response.json()) as ProfileResponse;
      const bindings = body.profile?.providerBindings ?? nextBindings;
      setProviderBindings(bindings);
      const binding = bindings.find(
        (candidate) =>
          candidate.provider === "xai" && candidate.qualityTier === "standard",
      );
      if (binding?.voiceId) setVoiceId(binding.voiceId);
      if (body.profile?.resolvedGender) {
        setResolvedGender(body.profile.resolvedGender);
      }
      if (body.profile?.genderMode) setGenderMode(body.profile.genderMode);
    } finally {
      setSaving(false);
    }
  }

  async function preview() {
    setPreviewing(true);
    try {
      const response = await fetch(
        `/api/employees/${encodeURIComponent(employeeId)}/voice-profile/preview`,
        { method: "POST", headers: await authHeaders(workspaceId) },
      );
      if (!response.ok) return;
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audio.addEventListener("ended", () => URL.revokeObjectURL(url), {
        once: true,
      });
      await audio.play();
    } finally {
      setPreviewing(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-ink-3">Voice gender</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {(
            [
              { id: "auto", label: "Auto" },
              { id: "female", label: "Female" },
              { id: "male", label: "Male" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={saving}
              onClick={() =>
                void save({
                  nextGenderMode: option.id,
                  // Let the server pick a voice in the new gender pool.
                  nextVoiceId:
                    option.id === "female"
                      ? "eve"
                      : option.id === "male"
                        ? "leo"
                        : voiceId,
                })
              }
              className={cn(
                "rounded-lg border px-2 py-2 text-xs transition-colors",
                genderMode === option.id
                  ? "border-accent-500 bg-accent-500/10 text-ink"
                  : "border-border text-ink-3 hover:bg-muted",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3">
          Auto uses the employee first name
          {employeeName ? ` (“${employeeName.split(/\s+/)[0]}”)` : ""} so female
          employees get a female voice and male employees a male voice. Talking
          style stays separate.
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-ink-3">
          {resolvedGender === "female" ? "Female" : "Male"} voice
        </p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {voiceOptions.map((voice) => (
            <button
              key={voice.id}
              type="button"
              disabled={saving}
              onClick={() => void save({ nextVoiceId: voice.id })}
              className={cn(
                "rounded-lg border px-2 py-2 text-xs transition-colors",
                voice.id === voiceId
                  ? "border-accent-500 bg-accent-500/10 text-ink"
                  : "border-border text-ink-3 hover:bg-muted",
              )}
            >
              {voice.label}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="flex justify-between text-xs text-ink-3">
          <span>Speaking pace</span>
          <span>{pace.toFixed(1)}×</span>
        </span>
        <input
          type="range"
          min={0.7}
          max={1.5}
          step={0.1}
          value={pace}
          disabled={saving}
          onChange={(event) => setPace(Number(event.target.value))}
          onPointerUp={() => void save({ nextPace: pace })}
          className="mt-2 w-full accent-accent-500"
        />
      </label>
      <p className="text-[11px] text-ink-3">
        This identity stays with the employee even when AdeHQ changes voice infrastructure.
      </p>
      <button
        type="button"
        disabled={saving || previewing}
        onClick={() => void preview()}
        className="text-xs font-medium text-accent-700 hover:text-accent-800 disabled:opacity-50"
      >
        {previewing ? "Preparing preview…" : "Preview employee voice"}
      </button>
    </div>
  );
}
