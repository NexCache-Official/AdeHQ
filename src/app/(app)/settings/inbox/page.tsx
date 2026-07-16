"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Copy, Loader2, Mail, Shield } from "lucide-react";
import { useStore } from "@/lib/demo-store";
import { PageHeader } from "@/components/Page";
import { Card, Button } from "@/components/ui";
import { ClaimGate } from "@/components/inbox/ClaimGate";
import { fetchMailbox } from "@/lib/inbox/client";
import type { InboxMailboxResponse } from "@/lib/inbox/types";

export default function SettingsInboxPage() {
  const { state } = useStore();
  const router = useRouter();
  const workspaceId = state.workspace.id;
  const workspaceName = state.workspace.name;

  const [mailbox, setMailbox] = useState<InboxMailboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMailbox(workspaceId);
      setMailbox(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inbox settings.");
      setMailbox(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Claim and manage this workspace’s shared email address."
        icon={<Mail className="h-5 w-5" />}
      />

      {loading && (
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading inbox…
        </div>
      )}

      {error && (
        <Card className="p-5">
          <p className="text-sm text-rose-600">{error}</p>
          <Button size="sm" className="mt-3" onClick={() => void load()}>
            Retry
          </Button>
        </Card>
      )}

      {!loading && !error && mailbox && !mailbox.claimed && (
        <Card className="p-6">
          <h2 className="mb-1 text-sm font-semibold text-ink">Choose your workspace inbox</h2>
          <ClaimGate
            workspaceId={workspaceId}
            canClaim={mailbox.canClaim}
            defaultDisplayName={workspaceName}
            variant="page"
            onClaimed={() => {
              void load().then(() => {
                router.push("/inbox");
              });
            }}
          />
        </Card>
      )}

      {!loading && !error && mailbox?.claimed && (
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
                <Mail className="h-5 w-5 text-accent-d" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-ink">Workspace address</h2>
                <p className="mt-0.5 text-xs text-ink-3">
                  Shared inbox for {workspaceName}. The local-part cannot be changed after claim.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <code className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm font-medium text-ink">
                    {mailbox.mailbox?.address}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (mailbox.mailbox?.address) void copyAddress(mailbox.mailbox.address);
                    }}
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </>
                    )}
                  </Button>
                </div>
                {mailbox.mailbox?.displayName ? (
                  <p className="mt-2 text-sm text-ink-2">
                    Display name:{" "}
                    <span className="font-medium text-ink">{mailbox.mailbox?.displayName}</span>
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-5">
              <Link
                href="/inbox"
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Open Inbox <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-3">
              <Shield className="mt-0.5 h-4 w-4 text-ink-3" />
              <div>
                <h2 className="text-sm font-semibold text-ink">Assistance &amp; access</h2>
                <p className="mt-1 text-sm text-ink-3">
                  Organise / draft assistance and AI settings live inside Inbox. Admins manage who
                  can read and send from the mailbox there.
                </p>
                <Link
                  href="/inbox"
                  className="mt-3 inline-flex text-sm font-medium text-accent-d hover:underline"
                >
                  Manage in Inbox →
                </Link>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
