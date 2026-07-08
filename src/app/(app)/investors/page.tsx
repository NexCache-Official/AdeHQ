"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { PageContainer, PageHeader } from "@/components/Page";
import { EmptyState } from "@/components/States";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { fetchInvestorsData, patchInvestorPipeline, createInvestorFirm } from "@/lib/investors/client";
import type {
  InvestorPipelineRecord,
  InvestorsListPayload,
  InvestorStage,
} from "@/lib/investors/types";
import {
  ColumnEmpty,
  KanbanColumn,
  ProgressMeter,
  ScoreRing,
  SearchInput,
  SegmentedControl,
  StatGrid,
  StatusPill,
  Toolbar,
  WorkspaceCanvas,
  type StatDef,
  type Tone,
} from "@/components/workspace/WorkspaceKit";
import { IntegrationsStrip } from "@/components/workspace/IntegrationsStrip";
import { cn } from "@/lib/utils";
import {
  Banknote,
  Building2,
  Gauge,
  Handshake,
  RefreshCw,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

type Tab = "pipeline" | "firms" | "contacts";

const STAGE_META: Record<InvestorStage, { label: string; tone: Tone }> = {
  target: { label: "Target", tone: "slate" },
  researched: { label: "Researched", tone: "sky" },
  drafted: { label: "Drafted", tone: "indigo" },
  contacted: { label: "Contacted", tone: "violet" },
  replied: { label: "Replied", tone: "amber" },
  meeting: { label: "Meeting", tone: "accent" },
  passed: { label: "Passed", tone: "rose" },
  committed: { label: "Committed", tone: "emerald" },
};

function fitTone(score: number | null): Tone {
  if (score == null) return "slate";
  if (score >= 75) return "emerald";
  if (score >= 50) return "amber";
  return "rose";
}

function formatMoney(amount: number | null, currency = "USD"): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export default function InvestorsPage() {
  const { state, backend } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = state.workspace.id;

  const [data, setData] = useState<InvestorsListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pipeline");
  const [query, setQuery] = useState("");
  const [dragPipelineId, setDragPipelineId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<InvestorStage | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const selectedFirmId = searchParams.get("firm");
  const selectedContactId = searchParams.get("contact");
  const selectedPipelineId = searchParams.get("pipeline");

  const load = useCallback(async () => {
    if (backend !== "supabase" || !workspaceId) {
      setData({
        firms: [], contacts: [], pipeline: [], stages: [],
        summary: { firmCount: 0, contactCount: 0, pipelineCount: 0, activePipelineCount: 0, averageFitScore: null },
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await fetchInvestorsData({ workspaceId, query: query || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load investors.");
    } finally {
      setLoading(false);
    }
  }, [backend, workspaceId, query]);

  useEffect(() => { void load(); }, [load]);

  const firmById = useMemo(() => new Map((data?.firms ?? []).map((f) => [f.id, f])), [data?.firms]);
  const contactById = useMemo(() => new Map((data?.contacts ?? []).map((c) => [c.id, c])), [data?.contacts]);

  const pipelineByStage = useMemo(() => {
    const map = new Map<InvestorStage, InvestorPipelineRecord[]>();
    for (const stage of data?.stages ?? []) map.set(stage, []);
    for (const record of data?.pipeline ?? []) {
      const list = map.get(record.stage) ?? [];
      list.push(record);
      map.set(record.stage, list);
    }
    return map;
  }, [data]);

  const committed = useMemo(() => (data?.pipeline ?? []).filter((p) => p.stage === "committed"), [data]);
  const committedAmount = committed.reduce((s, p) => s + (p.targetAmount ?? 0), 0);
  const targetAmount = (data?.pipeline ?? []).reduce((s, p) => s + (p.targetAmount ?? 0), 0);
  const raiseProgress = targetAmount > 0 ? Math.round((committedAmount / targetAmount) * 100) : 0;
  const currency = (data?.pipeline ?? []).find((p) => p.currency)?.currency ?? "USD";

  const stats = useMemo<StatDef[]>(() => {
    const s = data?.summary;
    return [
      { label: "Firms", value: s?.firmCount ?? 0, icon: Building2, tone: "accent", hint: `${s?.contactCount ?? 0} contacts` },
      { label: "Active pipeline", value: s?.activePipelineCount ?? 0, icon: TrendingUp, tone: "violet", hint: `${s?.pipelineCount ?? 0} total` },
      { label: "Committed", value: formatMoney(committedAmount, currency), icon: Handshake, tone: "emerald", hint: `${committed.length} investors` },
      { label: "Avg fit", value: s?.averageFitScore != null ? `${s.averageFitScore}` : "—", icon: Gauge, tone: "amber", hint: "Across pipeline" },
    ];
  }, [data, committedAmount, committed.length, currency]);

  const openDetail = (params: { firm?: string; contact?: string; pipeline?: string }) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("firm"); next.delete("contact"); next.delete("pipeline");
    if (params.firm) next.set("firm", params.firm);
    if (params.contact) next.set("contact", params.contact);
    if (params.pipeline) next.set("pipeline", params.pipeline);
    router.replace(`/investors?${next.toString()}`, { scroll: false });
  };
  const closeDetail = () => router.replace("/investors", { scroll: false });

  const movePipeline = async (pipelineId: string, stage: InvestorStage) => {
    if (!data || backend !== "supabase") return;
    const prev = data;
    setData({
      ...data,
      pipeline: data.pipeline.map((record) =>
        record.id === pipelineId ? { ...record, stage } : record,
      ),
    });
    try {
      await patchInvestorPipeline(workspaceId, pipelineId, { stage });
    } catch {
      setData(prev);
      setError("Could not move investor. Try again.");
    }
  };

  const handleCreateFirm = async () => {
    const name = createName.trim();
    if (!name || backend !== "supabase") return;
    setCreateBusy(true);
    setError(null);
    try {
      await createInvestorFirm(workspaceId, { name });
      setCreateOpen(false);
      setCreateName("");
      await load();
      setTab("firms");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create firm.");
    } finally {
      setCreateBusy(false);
    }
  };

  const selectedFirm = selectedFirmId ? firmById.get(selectedFirmId) : null;
  const selectedContact = selectedContactId ? contactById.get(selectedContactId) : null;
  const selectedPipeline = data?.pipeline.find((p) => p.id === selectedPipelineId) ?? null;

  const isEmpty = !loading && !error && (data?.firms.length ?? 0) + (data?.pipeline.length ?? 0) + (data?.contacts.length ?? 0) === 0;

  return (
    <PageContainer wide>
      <PageHeader
        title="Investors"
        subtitle="Your fundraising command center — track firms, warm intros, and every conversation from first target to signed commitment."
        icon={<TrendingUp className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setCreateOpen(true)} disabled={backend !== "supabase"}>
              Add firm
            </Button>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
            </Button>
          </div>
        }
      />

      <WorkspaceCanvas>
        {backend !== "supabase" && (
          <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-amber-800">
            Connect a live workspace to see fundraising data. In demo mode, ask a Fundraising employee to add investor firms.
          </div>
        )}

        {data && <StatGrid stats={stats} className="mb-4" />}

        {targetAmount > 0 && (
          <div className="mb-5 rounded-2xl border border-border bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-semibold text-ink-2">
                <Banknote className="h-4 w-4 text-emerald-600" /> Raise progress
              </span>
              <span className="text-xs text-ink-3">
                <span className="font-bold text-ink">{formatMoney(committedAmount, currency)}</span> of {formatMoney(targetAmount, currency)}
              </span>
            </div>
            <ProgressMeter value={raiseProgress} tone="emerald" height="h-2.5" />
          </div>
        )}

        <Toolbar>
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { id: "pipeline", label: "Pipeline", icon: TrendingUp, count: data?.pipeline.length },
              { id: "firms", label: "Firms", icon: Building2, count: data?.firms.length },
              { id: "contacts", label: "Contacts", icon: Users, count: data?.contacts.length },
            ]}
          />
          <SearchInput value={query} onChange={setQuery} onSubmit={() => void load()} placeholder="Search investors…" className="w-full sm:max-w-xs" />
        </Toolbar>

        {loading && <p className="text-sm text-ink-3">Loading investors…</p>}
        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/8 px-4 py-3 text-sm text-rose-700">{error}</div>}

        {isEmpty && (
          <div className="rounded-2xl border border-border bg-surface">
            <EmptyState icon={TrendingUp} title="No pipeline yet" description="Ask a Fundraising employee to add investor firms and build your pipeline from chat." />
          </div>
        )}

        {!loading && !error && !isEmpty && tab === "pipeline" && (
          <div className="flex gap-3 overflow-x-auto pb-3">
            {(data?.stages ?? []).map((stage) => {
              const records = pipelineByStage.get(stage) ?? [];
              const meta = STAGE_META[stage];
              const stageTotal = records.reduce((s, r) => s + (r.targetAmount ?? 0), 0);
              return (
                <KanbanColumn
                  key={stage}
                  title={meta.label}
                  tone={meta.tone}
                  count={records.length}
                  width="w-[248px]"
                  active={overStage === stage}
                  onDragOver={(e) => {
                    if (!dragPipelineId) return;
                    e.preventDefault();
                    setOverStage(stage);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragPipelineId) void movePipeline(dragPipelineId, stage);
                    setDragPipelineId(null);
                    setOverStage(null);
                  }}
                  footer={stageTotal > 0 ? <span className="font-semibold text-ink-2">{formatMoney(stageTotal, currency)}</span> : undefined}
                >
                  {records.length === 0 ? (
                    <ColumnEmpty label="Empty" />
                  ) : (
                    records.map((record) => {
                      const firm = record.firmId ? firmById.get(record.firmId) : null;
                      return (
                        <div
                          key={record.id}
                          draggable={backend === "supabase"}
                          onDragStart={() => setDragPipelineId(record.id)}
                          onDragEnd={() => {
                            setDragPipelineId(null);
                            setOverStage(null);
                          }}
                          className="group w-full cursor-grab rounded-xl border border-border bg-surface p-3 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lift active:cursor-grabbing"
                        >
                          <button
                            type="button"
                            onClick={() => openDetail({ pipeline: record.id, firm: record.firmId ?? undefined })}
                            className="w-full text-left"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="flex-1 truncate text-[13px] font-semibold text-ink">{firm?.name ?? "Unlinked firm"}</span>
                              {record.fitScore != null && <ScoreRing score={record.fitScore} tone={fitTone(record.fitScore)} size={30} />}
                            </div>
                            {record.targetAmount != null && (
                              <div className="mt-1.5 text-[13px] font-bold text-emerald-600">{formatMoney(record.targetAmount, record.currency || currency)}</div>
                            )}
                            {firm?.stageFocus && <div className="mt-1 truncate text-[11px] text-ink-3">{firm.stageFocus}</div>}
                          </button>
                        </div>
                      );
                    })
                  )}
                </KanbanColumn>
              );
            })}
          </div>
        )}

        {!loading && !error && !isEmpty && tab === "firms" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.firms ?? []).map((firm) => {
              const rec = data?.pipeline.find((p) => p.firmId === firm.id);
              return (
                <button
                  key={firm.id}
                  type="button"
                  onClick={() => openDetail({ firm: firm.id })}
                  className="group rounded-2xl border border-border bg-surface p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lift"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-accent-500/10 text-violet-600">
                      <Building2 className="h-5 w-5" />
                    </span>
                    {rec && <StatusPill tone={STAGE_META[rec.stage].tone} label={STAGE_META[rec.stage].label} />}
                  </div>
                  <div className="mt-3 truncate font-semibold text-ink">{firm.name}</div>
                  {firm.focus && <div className="mt-0.5 line-clamp-2 text-xs text-ink-3">{firm.focus}</div>}
                  {firm.stageFocus && <div className="mt-2 inline-block rounded-md bg-ink/5 px-2 py-0.5 text-[10px] font-medium text-ink-2">{firm.stageFocus}</div>}
                </button>
              );
            })}
          </div>
        )}

        {!loading && !error && !isEmpty && tab === "contacts" && (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-ink-3">
                    <th className="px-4 py-2.5 font-semibold">Name</th>
                    <th className="px-4 py-2.5 font-semibold">Title</th>
                    <th className="px-4 py-2.5 font-semibold">Firm</th>
                    <th className="px-4 py-2.5 font-semibold">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.contacts ?? []).map((c) => {
                    const firm = c.firmId ? firmById.get(c.firmId) : null;
                    return (
                      <tr key={c.id} onClick={() => openDetail({ contact: c.id })} className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/12 text-[11px] font-bold text-violet-600">
                              {c.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                            </span>
                            <span className="font-medium text-ink">{c.fullName}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-ink-2">{c.title ?? "—"}</td>
                        <td className="px-4 py-3 text-ink-2">{firm?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-ink-3">{c.email ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <IntegrationsStrip
          title="Fundraising integrations"
          ids={["affinity", "airtable", "docsend", "crunchbase", "gsheets", "gmail", "calendly", "notion", "zapier"]}
        />
      </WorkspaceCanvas>

      {(selectedFirm || selectedContact || selectedPipeline) && (
        <div>
          <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={closeDetail} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-border bg-surface shadow-panel">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <span className="text-sm font-semibold text-ink">Details</span>
              <button onClick={closeDetail} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-muted hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-5 p-5">
              {selectedPipeline && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <StatusPill tone={STAGE_META[selectedPipeline.stage].tone} label={STAGE_META[selectedPipeline.stage].label} />
                    {selectedPipeline.fitScore != null && <ScoreRing score={selectedPipeline.fitScore} tone={fitTone(selectedPipeline.fitScore)} size={40} />}
                  </div>
                  {selectedPipeline.targetAmount != null && (
                    <div className="rounded-xl border border-border bg-muted/40 p-3">
                      <div className="text-[11px] text-ink-3">Target amount</div>
                      <div className="text-lg font-bold text-emerald-600">{formatMoney(selectedPipeline.targetAmount, selectedPipeline.currency || currency)}</div>
                    </div>
                  )}
                  {selectedPipeline.notes && <p className="whitespace-pre-wrap text-sm text-ink-2">{selectedPipeline.notes}</p>}
                </div>
              )}
              {selectedFirm && (
                <div className="space-y-2 border-t border-border pt-4 first:border-0 first:pt-0">
                  <h2 className="text-lg font-bold text-ink">{selectedFirm.name}</h2>
                  {selectedFirm.website && <a href={selectedFirm.website} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">{selectedFirm.website}</a>}
                  {selectedFirm.focus && <p className="text-sm text-ink-2">{selectedFirm.focus}</p>}
                  {selectedFirm.notes && <p className="whitespace-pre-wrap text-sm text-ink-3">{selectedFirm.notes}</p>}
                </div>
              )}
              {selectedContact && (
                <div className="space-y-2 border-t border-border pt-4 first:border-0 first:pt-0">
                  <h2 className="text-lg font-bold text-ink">{selectedContact.fullName}</h2>
                  {selectedContact.title && <p className="text-sm text-ink-2">{selectedContact.title}</p>}
                  {selectedContact.email && <p className="text-sm text-ink-3">{selectedContact.email}</p>}
                  {selectedContact.linkedinUrl && <a href={selectedContact.linkedinUrl} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">LinkedIn</a>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)}>
        <ModalHeader title="Add investor firm" onClose={() => setCreateOpen(false)} />
        <div className="space-y-4 p-4">
          <input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Firm name"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateFirm();
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={createBusy || !createName.trim()} onClick={() => void handleCreateFirm()}>
              {createBusy ? "Creating…" : "Create firm"}
            </Button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}
