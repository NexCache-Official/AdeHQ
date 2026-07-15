"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui";
import { useStore } from "@/lib/demo-store";
import { supabase } from "@/lib/supabase/client";
import {
  acceptInvitationByToken,
  declineInvitationByToken,
  fetchInvitePreview,
  type InvitePreview,
} from "@/lib/workspace/invitations-client";
import { roleLabel } from "@/lib/workspace/permissions";
import { ArrowRight, Building2 } from "lucide-react";

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const router = useRouter();
  const { actions, hydrated, state } = useStore();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [joinedMessage, setJoinedMessage] = useState<string | null>(null);

  const nextPath = `/invite/${encodeURIComponent(token)}`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setAuthed(Boolean(data.session?.user));
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(Boolean(session?.user));
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setLoadError("Missing invitation token.");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchInvitePreview(token);
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Invitation not found.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onAccept = useCallback(async () => {
    if (!token) return;
    setActionError(null);
    setBusy("accept");
    try {
      const result = await acceptInvitationByToken(token);
      await actions.switchWorkspace(result.workspaceId);
      setJoinedMessage(`Joined ${result.workspaceName}`);
      router.replace("/");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to accept invitation.");
    } finally {
      setBusy(null);
    }
  }, [actions, router, token]);

  const onDecline = useCallback(async () => {
    if (!token) return;
    setActionError(null);
    setBusy("decline");
    try {
      await declineInvitationByToken(token);
      router.replace(state.workspace.id ? "/" : "/onboarding");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to decline invitation.");
    } finally {
      setBusy(null);
    }
  }, [router, state.workspace.id, token]);

  if (loadError) {
    return (
      <AuthShell>
        <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-slate-950">
          Invitation unavailable
        </h1>
        <p className="mt-2 text-[15px] text-slate-500">{loadError}</p>
        <Link href="/login" className="mt-6 inline-flex text-sm font-medium text-accent-600">
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  if (!preview) {
    return (
      <AuthShell>
        <p className="text-sm text-slate-500">Loading invitation…</p>
      </AuthShell>
    );
  }

  const canAct =
    preview.status === "pending" && !preview.expired && authed === true && hydrated;

  return (
    <AuthShell>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
        <Building2 className="h-6 w-6" />
      </div>
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] text-slate-950">
        Join {preview.workspaceName}
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
        You&apos;ve been invited as <span className="font-medium text-slate-700">{roleLabel(preview.role)}</span>
        {" "}
        ({preview.invitedEmail}).
      </p>

      {preview.expired || preview.status !== "pending" ? (
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {preview.expired
            ? "This invitation has expired. Ask an admin to send a new one."
            : `This invitation is ${preview.status}.`}
        </p>
      ) : null}

      {actionError ? (
        <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</p>
      ) : null}
      {joinedMessage ? (
        <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{joinedMessage}</p>
      ) : null}

      <div className="mt-7 space-y-3">
        {authed === false ? (
          <>
            <Link
              href={`/login?next=${encodeURIComponent(nextPath)}`}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white"
            >
              Sign in to join <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={`/signup?next=${encodeURIComponent(nextPath)}`}
              className="flex w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
            >
              Create an account
            </Link>
          </>
        ) : (
          <>
            <Button
              className="w-full"
              onClick={() => void onAccept()}
              disabled={!canAct || busy !== null}
            >
              {busy === "accept" ? "Joining…" : "Accept invitation"}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => void onDecline()}
              disabled={!canAct || busy !== null}
            >
              {busy === "decline" ? "Declining…" : "Decline"}
            </Button>
          </>
        )}
      </div>
    </AuthShell>
  );
}
