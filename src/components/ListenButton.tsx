"use client";

import { useState } from "react";
import { Loader2, Volume2 } from "lucide-react";
import { authHeaders } from "@/lib/api/auth-client";
import { cn } from "@/lib/utils";

/**
 * Optional "Listen" control on AI replies. Text remains authoritative.
 * Never autoplays.
 */
export function ListenButton({
  workspaceId,
  text,
  messageId,
  roomId,
  topicId,
  employeeId,
  className,
}: {
  workspaceId: string;
  text: string;
  messageId?: string;
  roomId?: string;
  topicId?: string;
  employeeId?: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wh, setWh] = useState<number | null>(null);

  if (!text.trim()) return null;

  const onListen = async () => {
    setError(null);
    setLoading(true);
    try {
      const headers = await authHeaders(workspaceId);
      const res = await fetch("/api/voice/synthesize", {
        method: "POST",
        headers,
        body: JSON.stringify({
          text,
          intent: "read_aloud",
          messageId,
          roomId,
          topicId,
          employeeId,
          confirmed: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not generate speech");
      setAudioUrl(String(data.signedUrl ?? ""));
      setWh(typeof data.estimatedWh === "number" ? data.estimatedWh : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Listen failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn("mt-1 flex flex-col gap-1", className)}>
      <button
        type="button"
        onClick={() => void onListen()}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Volume2 className="h-3 w-3" />
        )}
        Listen
        {wh != null ? <span className="tabular-nums text-slate-400">· {wh.toFixed(2)} WH</span> : null}
      </button>
      {audioUrl ? (
        <audio controls preload="none" src={audioUrl} className="h-8 w-full max-w-xs" />
      ) : null}
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}
