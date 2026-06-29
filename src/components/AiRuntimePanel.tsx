"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_SILICONFLOW_MODEL,
  ENABLE_DEMO_MODE,
} from "@/lib/config/features";
import { MODEL_MODE_LABELS, type ModelMode } from "@/lib/ai/model-catalog";
import { Button, Card } from "./ui";
import { Activity, Bot, Sparkles, Zap } from "lucide-react";

type RuntimeSnapshot = {
  siliconflowConfigured?: boolean;
  openAiConfigured: boolean;
  defaultProvider?: string;
  defaultSiliconflowModel?: string;
  defaultModel: string;
  environment: string;
  demoModeEnabled: boolean;
  last?: {
    at: string;
    provider: string;
    model: string;
    modelMode?: string;
    mode: string;
    fallbackReason?: string;
    error?: string;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
    durationMs?: number;
  };
  recent: {
    at: string;
    provider: string;
    model: string;
    modelMode?: string;
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
  const [providerTestProvider, setProviderTestProvider] = useState("siliconflow");
  const [providerTestMode, setProviderTestMode] = useState<ModelMode>("cheap");
  const [providerTestPrompt, setProviderTestPrompt] = useState("Reply with one short sentence.");
  const [providerTestResult, setProviderTestResult] = useState<string | null>(null);
  const [providerTestBusy, setProviderTestBusy] = useState(false);

  const canAdmin =
    backend === "supabase" &&
    state.workspaceMembers.some(
      (m) =>
        m.userId === state.user?.id && (m.role === "owner" || m.role === "admin"),
    );

  const refreshSnapshot = async () => {
    if (!state.workspace.id) return;
    const headers = await authHeaders();
    const res = await fetch(`/api/ai/runtime?workspaceId=${state.workspace.id}`, { headers });
    if (!res.ok) throw new Error("Unable to load runtime status.");
    return (await res.json()) as RuntimeSnapshot;
  };

  useEffect(() => {
    if (!canAdmin || !state.workspace.id) {
      setLoading(false);
      return;
    }

    let active = true;
    void (async () => {
      try {
        const data = await refreshSnapshot();
        if (active) setSnapshot(data ?? null);
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

  const runEmployeeTest = async () => {
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
      const snap = await refreshSnapshot();
      setSnapshot(snap ?? null);
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setTestBusy(false);
    }
  };

  const runProviderTest = async () => {
    if (!state.workspace.id || !providerTestPrompt.trim()) return;
    setProviderTestBusy(true);
    setProviderTestResult(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/ai/test-provider`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          workspaceId: state.workspace.id,
          provider: providerTestProvider,
          modelMode: providerTestMode,
          prompt: providerTestPrompt.trim(),
        }),
      });

      const raw = await res.text();
      let data: { ok?: boolean; error?: string; reply?: string; provider?: string; model?: string; latencyMs?: number; fallbackTier?: number };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        if (res.status === 404) {
          throw new Error(
            "Test provider API not found. Redeploy the latest version of AdeHQ.",
          );
        }
        throw new Error(raw.slice(0, 200) || `HTTP ${res.status}`);
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Provider test failed (HTTP ${res.status}).`);
      }

      setProviderTestResult(
        `${data.reply}\n\n(${data.provider}/${data.model} · ${data.latencyMs}ms · health check)`,
      );
      const snap = await refreshSnapshot();
      setSnapshot(snap ?? null);
    } catch (err) {
      setProviderTestResult(err instanceof Error ? err.message : "Provider test failed.");
    } finally {
      setProviderTestBusy(false);
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
          <Stat label="SiliconFlow configured" value={snapshot?.siliconflowConfigured ? "Yes" : "No"} />
          <Stat label="OpenAI configured" value={snapshot?.openAiConfigured ? "Yes" : "No"} />
          <Stat label="Default provider" value={snapshot?.defaultProvider ?? "siliconflow"} />
          <Stat label="SiliconFlow model" value={snapshot?.defaultSiliconflowModel ?? DEFAULT_SILICONFLOW_MODEL} />
          <Stat label="OpenAI model" value={snapshot?.defaultModel ?? DEFAULT_OPENAI_MODEL} />
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
          {snapshot?.last?.modelMode && (
            <Stat label="Last mode" value={snapshot.last.modelMode} />
          )}
          {snapshot?.last?.estimatedCostUsd !== undefined && (
            <Stat label="Last est. cost" value={`$${snapshot.last.estimatedCostUsd.toFixed(6)}`} />
          )}
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
            {snapshot.recent.map((entry, i) => (
              <div key={entry.at + entry.model + i} className="text-xs text-slate-600">
                <Activity className="mr-1 inline h-3 w-3" />
                {entry.mode} · {entry.provider}/{entry.model}
                {entry.modelMode ? ` · ${entry.modelMode}` : ""}
                {entry.fallbackReason ? ` · ${entry.fallbackReason}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Zap className="h-4 w-4 text-accent-600" /> Test provider (isolated)
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Health-check SiliconFlow or OpenAI without room context. Run this before debugging employee replies.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            className="input-field"
            value={providerTestProvider}
            onChange={(e) => setProviderTestProvider(e.target.value)}
          >
            <option value="siliconflow">SiliconFlow</option>
            <option value="openai">OpenAI</option>
          </select>
          <select
            className="input-field"
            value={providerTestMode}
            onChange={(e) => setProviderTestMode(e.target.value as ModelMode)}
          >
            {(Object.keys(MODEL_MODE_LABELS) as ModelMode[])
              .filter((m) => m !== "creative")
              .map((m) => (
                <option key={m} value={m}>
                  {MODEL_MODE_LABELS[m]}
                </option>
              ))}
          </select>
        </div>
        <textarea
          className="input-field mt-3 min-h-[60px]"
          value={providerTestPrompt}
          onChange={(e) => setProviderTestPrompt(e.target.value)}
        />
        <Button className="mt-3" size="sm" onClick={runProviderTest} disabled={providerTestBusy}>
          {providerTestBusy ? "Testing…" : "Test provider"}
        </Button>
        {providerTestResult && (
          <div className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-700 whitespace-pre-wrap">
            {providerTestResult}
          </div>
        )}
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Bot className="h-4 w-4 text-accent-600" /> Test employee reply
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            className="input-field"
            value={testEmployeeId}
            onChange={(e) => setTestEmployeeId(e.target.value)}
          >
            {state.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.provider}/{e.modelMode ?? "balanced"})
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
        <Button className="mt-3" size="sm" onClick={runEmployeeTest} disabled={testBusy || !state.employees.length}>
          {testBusy ? "Testing…" : "Run employee test"}
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
