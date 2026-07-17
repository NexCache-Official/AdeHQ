"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HumanAvatar } from "@/components/EmployeeAvatar";
import { Button } from "@/components/ui";
import { authHeaders } from "@/lib/api/auth-client";
import { AVATAR_SIZE } from "@/lib/avatar/constants";
import { Camera, RotateCcw, Upload, ZoomIn } from "lucide-react";

type AvatarEditorProps = {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  onAvatarChange: (url: string) => void;
};

export function AvatarEditor({ userId, name, avatarUrl, onAvatarChange }: AvatarEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });

  useEffect(() => {
    return () => {
      if (draftUrl) URL.revokeObjectURL(draftUrl);
    };
  }, [draftUrl]);

  const openPicker = () => fileRef.current?.click();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    setError(null);
    if (draftUrl) URL.revokeObjectURL(draftUrl);
    setDraftUrl(URL.createObjectURL(file));
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const exportCroppedPng = useCallback(async (): Promise<Blob> => {
    const img = imgRef.current;
    if (!img || !natural.w) throw new Error("Image not ready.");

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");

    const view = 280; // crop viewport px in modal
    const scale = Math.max(view / natural.w, view / natural.h) * zoom;
    const drawW = natural.w * scale;
    const drawH = natural.h * scale;
    const dx = (view - drawW) / 2 + offset.x;
    const dy = (view - drawH) / 2 + offset.y;

    // Map viewport → output canvas
    const ratio = AVATAR_SIZE / view;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    ctx.drawImage(img, dx * ratio, dy * ratio, drawW * ratio, drawH * ratio);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Encode failed"))),
        "image/png",
        0.92,
      );
    });
  }, [natural, offset, zoom]);

  const saveCrop = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportCroppedPng();
      const headers = await authHeaders();
      const auth =
        headers instanceof Headers
          ? headers.get("Authorization") ?? ""
          : typeof headers === "object" && headers && "Authorization" in headers
            ? String((headers as Record<string, string>).Authorization ?? "")
            : "";
      const form = new FormData();
      form.append("file", blob, "avatar.png");
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: auth ? { Authorization: auth } : undefined,
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed.");
      onAvatarChange(String(body.avatarUrl));
      if (draftUrl) URL.revokeObjectURL(draftUrl);
      setDraftUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const resetGenerated = async () => {
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/profile/avatar", {
        method: "DELETE",
        headers,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Reset failed.");
      onAvatarChange(String(body.avatarUrl));
      if (draftUrl) URL.revokeObjectURL(draftUrl);
      setDraftUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="relative shrink-0">
        <HumanAvatar
          name={name}
          userId={userId}
          src={avatarUrl}
          size="xl"
          className="!rounded-[20px]"
        />
        <button
          type="button"
          onClick={openPicker}
          disabled={busy}
          className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-ink shadow-sm hover:bg-muted"
          aria-label="Change profile photo"
        >
          <Camera className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="text-sm font-semibold text-ink">Profile photo</p>
          <p className="mt-0.5 text-xs text-ink-3">
            Unique by default (your color + initials). Upload a photo to replace it — crop and zoom before saving.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={openPicker} disabled={busy}>
            <Upload className="h-3.5 w-3.5" /> Upload photo
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void resetGenerated()} disabled={busy}>
            <RotateCcw className="h-3.5 w-3.5" /> Use generated avatar
          </Button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />

        {draftUrl && (
          <div className="rounded-2xl border border-border bg-muted/40 p-3">
            <div
              className="relative mx-auto overflow-hidden rounded-2xl bg-ink/90"
              style={{ width: 280, height: 280, cursor: "grab" }}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
              }}
              onPointerMove={(e) => {
                if (!dragRef.current) return;
                setOffset({
                  x: dragRef.current.ox + (e.clientX - dragRef.current.x),
                  y: dragRef.current.oy + (e.clientY - dragRef.current.y),
                });
              }}
              onPointerUp={() => {
                dragRef.current = null;
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={draftUrl}
                alt="Crop preview"
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
                  transformOrigin: "center center",
                }}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                }}
              />
              <div className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-white/70 ring-inset" />
            </div>

            <label className="mt-3 flex items-center gap-2 text-xs text-ink-2">
              <ZoomIn className="h-3.5 w-3.5" />
              <span className="w-10">Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1"
              />
            </label>

            <div className="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (draftUrl) URL.revokeObjectURL(draftUrl);
                  setDraftUrl(null);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void saveCrop()}>
                {busy ? "Saving…" : "Save photo"}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
