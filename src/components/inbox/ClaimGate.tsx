"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, Check, Loader2, AlertCircle } from "lucide-react";
import { checkAvailability, claimMailbox } from "@/lib/inbox/client";
import { suggestLocalPartFromName } from "@/lib/inbox/suggest-local-part";
import { INBOX_DOMAIN_DEFAULT } from "@/lib/inbox/types";
import { cn } from "@/lib/utils";

type Availability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; address: string }
  | { state: "unavailable"; reason: string };

export function ClaimGate({
  workspaceId,
  canClaim,
  defaultDisplayName,
  onClaimed,
  variant = "centered",
}: {
  workspaceId: string;
  canClaim: boolean;
  defaultDisplayName: string;
  onClaimed: () => void;
  /** "page" = Settings layout (no outer centering card chrome). */
  variant?: "centered" | "page";
}) {
  const suggested = suggestLocalPartFromName(defaultDisplayName);
  const [localPart, setLocalPart] = useState(suggested);
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [availability, setAvailability] = useState<Availability>({ state: "idle" });
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const domain = INBOX_DOMAIN_DEFAULT;

  const runCheck = useCallback(
    (value: string) => {
      if (!value || value.length < 3) {
        setAvailability({ state: "idle" });
        return;
      }
      setAvailability({ state: "checking" });
      checkAvailability({ workspaceId, localPart: value })
        .then((res) => {
          if (res.available) {
            setAvailability({ state: "available", address: res.address ?? `${value}@${domain}` });
          } else {
            setAvailability({ state: "unavailable", reason: res.reason ?? "Not available." });
          }
        })
        .catch((err) => {
          setAvailability({
            state: "unavailable",
            reason: err instanceof Error ? err.message : "Check failed.",
          });
        });
    },
    [workspaceId, domain],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runCheck(localPart), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localPart, runCheck]);

  const onChangeLocal = (raw: string) => {
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setLocalPart(cleaned);
    setError(null);
  };

  const submit = async () => {
    if (claiming) return;
    setClaiming(true);
    setError(null);
    try {
      await claimMailbox({ workspaceId, localPart, displayName: displayName.trim() });
      onClaimed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim address.");
      runCheck(localPart);
    } finally {
      setClaiming(false);
    }
  };

  if (!canClaim) {
    const body = (
      <div className={cn(variant === "page" ? "text-left" : "text-center")}>
        <div
          className={cn(
            "mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted",
            variant === "centered" && "mx-auto",
          )}
        >
          <Mail className="h-6 w-6 text-ink-3" />
        </div>
        <h2 className="text-lg font-semibold text-ink">Inbox not set up yet</h2>
        <p className="mt-2 text-sm text-ink-3">
          Your workspace doesn&apos;t have a shared inbox address yet. Ask an owner or admin to
          claim one under Settings → Inbox.
        </p>
      </div>
    );
    if (variant === "page") return body;
    return <div className="flex h-full items-center justify-center p-8">{body}</div>;
  }

  const canSubmit = availability.state === "available" && !claiming;

  const form = (
    <>
      {variant === "centered" && (
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft">
          <Mail className="h-5 w-5 text-accent-d" />
        </div>
      )}
      {variant === "centered" && (
        <>
          <h1 className="text-xl font-semibold text-ink">Choose your workspace inbox</h1>
          <p className="mt-1.5 text-sm text-ink-3">
            Before you can send or receive email, pick a shared address for this workspace
            (for example <span className="font-medium text-ink-2">hello@{domain}</span>).
            Nobody gets an address automatically — you choose it, and it stays permanent.
          </p>
        </>
      )}
      {variant === "page" && (
        <p className="text-sm text-ink-3">
          Pick a shared address for this workspace (for example{" "}
          <span className="font-medium text-ink-2">hello@{domain}</span>). This is a suggestion
          only — nothing is assigned until you claim. The local-part stays permanent after claim.
        </p>
      )}

      <label className="mt-6 block text-xs font-medium text-ink-2">Address</label>
      <div className="mt-1.5 flex items-stretch overflow-hidden rounded-lg border border-border bg-canvas focus-within:border-accent">
        <input
          autoFocus
          value={localPart}
          onChange={(e) => onChangeLocal(e.target.value)}
          placeholder="hello"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-ink outline-none"
        />
        <span className="flex items-center border-l border-border bg-muted px-3 text-sm text-ink-3">
          @{domain}
        </span>
      </div>
      {suggested && localPart === suggested && (
        <p className="mt-1.5 text-[11px] text-ink-3">
          Suggested from your workspace name — edit freely before claiming.
        </p>
      )}

      <div className="mt-2 h-5 text-xs">
        {availability.state === "checking" && (
          <span className="flex items-center gap-1.5 text-ink-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking availability…
          </span>
        )}
        {availability.state === "available" && (
          <span className="flex items-center gap-1.5 text-emerald-600">
            <Check className="h-3.5 w-3.5" /> {availability.address} is available
          </span>
        )}
        {availability.state === "unavailable" && (
          <span className="flex items-center gap-1.5 text-rose-600">
            <AlertCircle className="h-3.5 w-3.5" /> {availability.reason}
          </span>
        )}
      </div>

      <label className="mt-4 block text-xs font-medium text-ink-2">Display name</label>
      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Workspace"
        className="mt-1.5 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />

      <div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-ink-2">
        <p className="font-medium text-ink">Organise inbox (default)</p>
        <p className="mt-1 text-ink-3">
          AdeHQ will classify and prioritise incoming email. It will not generate or send replies
          unless you request it. You can change assistance later in Inbox.
        </p>
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-rose-600">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {claiming && <Loader2 className="h-4 w-4 animate-spin" />}
        {claiming ? "Claiming…" : "Claim address"}
      </button>
    </>
  );

  if (variant === "page") {
    return <div className="max-w-lg">{form}</div>;
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-7 shadow-sm">
        {form}
      </div>
    </div>
  );
}
