"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { DEFAULT_OPENAI_MODEL, ENABLE_DEMO_MODE } from "@/lib/config/features";
import { Button, Card } from "./ui";
import { Activity, Bot, Sparkles } from "lucide-react";

type RuntimeSnapshot = {
  openAiConfigured: boolean;
  defaultModel: string;
  environment: string;
  demoModeEnabled: boolean;
  last?: {
    at: string;
    provider: string;
    model: string;
    mode: string;
    fallbackReason?: string;
    error?: string;
  };
  recent: {
    at: string;
    provider: string;
    model: string;
    mode: string;
    fallbackReason?: string;
    error?: string;
  }[];
};

export function AiRuntimePanel() {
  const { state, backend } = useStore();
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [testEmployeeId, setTestEmployeeId] = useState("");
  const [testRoomId, setTestRoomId] = useState("");
  const [testPrompt, setTestPrompt] = useState("What can you help with in this workspace?");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testMode, setTestMode] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  const canAdmin =
    backend === "supabase" &&
    state.workspaceMembers.some(
      (m) =>
        m.userId === state.user?.id && (m.role === "owner" || m.role === "admin"),
    );

  useEffect(() => {
    if (!canAdmin || !state.workspace.id) {
      setLoading(false);
      return;
    }

    let active = true;
    void (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/ai/runtime?workspaceId=${state.workspace.id}`, { headers });
        if (!res.ok) throw new Error("Unable to load runtime status.");
        const data = (await res.json()) as RuntimeSnapshot;
        if (active) setSnapshot(data);
      } catch {
        if (active) setSnapshot(null);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [canAdmin, state.workspace.id]);

  useEffect(() => {
    if (!testEmployeeId && state.employees[0]) setTestEmployeeId(state.employees[0].id);
    if (!testRoomId && state.rooms[0]) setTestRoomId(state.rooms[0].id);
  }, [state.employees, state.rooms, testEmployeeId, testRoomId]);

  const runTest = async () => {
    if (!testEmployeeId || !testRoomId || !testPrompt.trim()) return;
    setTestBusy(true);
    setTestResult(null);
    setTestMode(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/employees/${testEmployeeId}/respond`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          roomId: testRoomId,
          content: testPrompt.trim(),
          mode: "live",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed.");
      setTestResult(data.reply);
      setTestMode(data.aiMode ?? res.headers.get("x-adehq-ai-mode") ?? "unknown");
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setTestBusy(false);
    }
  };

  if (!canAdmin) return null;

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent-600" />
        <h2 className="text-sm font-semibold text-slate-900">AI Runtime</h2>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading runtime status…</p>
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Stat label="OpenAI configured" value={snapshot?.openAiConfigured ? "Yes" : "No"} />
          <Stat label="Default model" value={snapshot?.defaultModel ?? DEFAULT_OPENAI_MODEL} />
          <Stat label="Environment" value={snapshot?.environment ?? "unknown"} />
          <Stat label="Demo mode enabled" value={ENABLE_DEMO_MODE ? "Yes" : "No"} />
          <Stat
            label="Last request"
            value={
              snapshot?.last
                ? `${snapshot.last.mode} · ${snapshot.last.provider} · ${snapshot.last.model}`
                : "None yet"
            }
          />
          {snapshot?.last?.fallbackReason && (
            <Stat label="Last fallback reason" value={snapshot.last.fallbackReason} />
          )}
          {snapshot?.last?.error && <Stat label="Last error" value={snapshot.last.error} />}
        </dl>
      )}

      {snapshot?.recent && snapshot.recent.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Recent runtime events
          </h3>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
            {snapshot.recent.map((entry) => (
              <div key={entry.at + entry.model} className="text-xs text-slate-600">
                <Activity className="mr-1 inline h-3 w-3" />
                {entry.mode} · {entry.provider}/{entry.model}
                {entry.fallbackReason ? ` · ${entry.fallbackReason}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Bot className="h-4 w-4 text-accent-600" /> Test OpenAI employee reply
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            className="input-field"
            value={testEmployeeId}
            onChange={(e) => setTestEmployeeId(e.target.value)}
          >
            {state.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.provider}/{e.model})
              </option>
            ))}
          </select>
          <select
            className="input-field"
            value={testRoomId}
            onChange={(e) => setTestRoomId(e.target.value)}
          >
            {state.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="input-field mt-3 min-h-[80px]"
          value={testPrompt}
          onChange={(e) => setTestPrompt(e.target.value)}
        />
        <Button className="mt-3" size="sm" onClick={runTest} disabled={testBusy || !state.employees.length}>
          {testBusy ? "Testing…" : "Run test"}
        </Button>
        {testResult && (
          <div className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-700">
            <p className="mb-1 text-xs font-medium text-slate-500">
              Response {testMode ? `(mode: ${testMode})` : ""}
            </p>
            {testResult}
          </div>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
    </div>
  );
}
