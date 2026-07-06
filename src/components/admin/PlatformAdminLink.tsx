"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authHeaders } from "@/lib/api/auth-client";
import { Shield } from "lucide-react";

/** Link to AdeHQ Control for platform admins only. */
export function PlatformAdminLink() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/admin/me", { headers });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (body?.isPlatformAdmin) setVisible(true);
      } catch {
        // not an admin
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <Link
      href="/admin"
      className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-muted"
    >
      <Shield className="h-4 w-4 text-accent" />
      Open AdeHQ Control
    </Link>
  );
}
