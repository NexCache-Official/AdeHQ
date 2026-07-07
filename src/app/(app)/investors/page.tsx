"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { PageContainer, PageHeader } from "@/components/Page";
import { EmptyState } from "@/components/States";
import { Button } from "@/components/ui";
import { fetchInvestorsData } from "@/lib/investors/client";
import type {
  InvestorContact,
  InvestorFirm,
  InvestorPipelineRecord,
  InvestorsListPayload,
  InvestorStage,
} from "@/lib/investors/types";
import { cn } from "@/lib/utils";
import { Building2, Search, TrendingUp, Users } from "lucide-react";

type Tab = "pipeline" | "firms" | "contacts";

const STAGE_LABELS: Record<InvestorStage, string> = {
  target: "Target",
  researched: "Researched",
  drafted: "Drafted",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting",
  passed: "Passed",
  committed: "Committed",
};

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

  const selectedFirmId = searchParams.get("firm");
  const selectedContactId = searchParams.get("contact");
  const selectedPipelineId = searchParams.get("pipeline");

  const load = useCallback(async () => {
    if (backend !== "supabase" || !workspaceId) {
      setData({
        firms: [],
        contacts: [],
        pipeline: [],
        stages: [],
        summary: {
          firmCount: 0,
          contactCount: 0,
          pipelineCount: 0,
          activePipelineCount: 0,
          averageFitScore: null,
        },
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

  useEffect(() => {
    void load();
  }, [load]);

  const firmById = useMemo(
    () => new Map((data?.firms ?? []).map((f) => [f.id, f])),
    [data?.firms],
  );
  const contactById = useMemo(
    () => new Map((data?.contacts ?? []).map((c) => [c.id, c])),
    [data?.contacts],
  );

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

  const openDetail = (params: { firm?: string; contact?: string; pipeline?: string }) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("firm");
    next.delete("contact");
    next.delete("pipeline");
    if (params.firm) next.set("firm", params.firm);
    if (params.contact) next.set("contact", params.contact);
    if (params.pipeline) next.set("pipeline", params.pipeline);
    router.push(`/investors?${next.toString()}`);
  };

  const closeDetail = () => {
    router.push("/investors");
  };

  const selectedFirm = selectedFirmId ? firmById.get(selectedFirmId) : null;
  const selectedContact = selectedContactId ? contactById.get(selectedContactId) : null;
  const selectedPipeline = data?.pipeline.find((p) => p.id === selectedPipelineId) ?? null;

  return (
    <PageContainer>
      <PageHeader
        title="Investors"
        subtitle="Fundraising pipeline, firms, and contacts."
      />

      {data?.summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Firms" value={data.summary.firmCount} />
          <Stat label="Contacts" value={data.summary.contactCount} />
          <Stat label="Pipeline" value={data.summary.activePipelineCount} />
          <Stat
            label="Avg fit"
            value={data.summary.averageFitScore != null ? `${data.summary.averageFitScore}` : "—"}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
            placeholder="Search investors…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load()}
          />
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          Search
        </Button>
        <div className="flex rounded-lg border p-1">
          {(["pipeline", "firms", "contacts"] as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              className={cn(
                "rounded-md px-3 py-1.5 text-sm capitalize",
                tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
              onClick={() => setTab(key)}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading investors…</p>}

      {!loading && tab === "pipeline" && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {(data?.stages ?? []).map((stage) => (
            <div key={stage} className="min-w-[220px] flex-1 rounded-xl border bg-muted/20 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {STAGE_LABELS[stage]}
              </div>
              <div className="space-y-2">
                {(pipelineByStage.get(stage) ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">Empty</p>
                ) : (
                  (pipelineByStage.get(stage) ?? []).map((record) => {
                    const firm = record.firmId ? firmById.get(record.firmId) : null;
                    return (
                      <button
                        key={record.id}
                        type="button"
                        onClick={() => openDetail({ pipeline: record.id, firm: record.firmId ?? undefined })}
                        className="w-full rounded-lg border bg-card px-3 py-2 text-left text-sm hover:bg-muted/40"
                      >
                        <div className="font-medium">{firm?.name ?? "Unlinked firm"}</div>
                        {record.fitScore != null && (
                          <div className="text-xs text-muted-foreground">Fit {record.fitScore}/100</div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ))}
          {(data?.pipeline ?? []).length === 0 && (
            <EmptyState
              icon={TrendingUp}
              title="No pipeline records"
              description="Ask a fundraising employee to add investor firms from chat."
            />
          )}
        </div>
      )}

      {!loading && tab === "firms" && (
        <div className="space-y-2">
          {(data?.firms ?? []).length === 0 ? (
            <EmptyState icon={Building2} title="No firms" description="Create firms via investor.createFirm in chat." />
          ) : (
            data?.firms.map((firm) => (
              <FirmRow key={firm.id} firm={firm} onOpen={() => openDetail({ firm: firm.id })} />
            ))
          )}
        </div>
      )}

      {!loading && tab === "contacts" && (
        <div className="space-y-2">
          {(data?.contacts ?? []).length === 0 ? (
            <EmptyState icon={Users} title="No contacts" description="Add contacts via chat." />
          ) : (
            data?.contacts.map((contact) => {
              const firm = contact.firmId ? firmById.get(contact.firmId) : null;
              return (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  firmName={firm?.name}
                  onOpen={() => openDetail({ contact: contact.id })}
                />
              );
            })
          )}
        </div>
      )}

      {(selectedFirm || selectedContact || selectedPipeline) && (
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md border-l bg-background p-6 shadow-xl">
          <Button variant="ghost" className="mb-4" onClick={closeDetail}>
            Close
          </Button>
          {selectedFirm && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">{selectedFirm.name}</h2>
              {selectedFirm.website && <p className="text-sm">{selectedFirm.website}</p>}
              {selectedFirm.focus && <p className="text-sm text-muted-foreground">{selectedFirm.focus}</p>}
            </div>
          )}
          {selectedContact && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">{selectedContact.fullName}</h2>
              {selectedContact.title && <p className="text-sm">{selectedContact.title}</p>}
              {selectedContact.email && <p className="text-sm text-muted-foreground">{selectedContact.email}</p>}
            </div>
          )}
          {selectedPipeline && (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Pipeline record</h2>
              <p className="text-sm">Stage: {STAGE_LABELS[selectedPipeline.stage]}</p>
              {selectedPipeline.fitScore != null && (
                <p className="text-sm">Fit score: {selectedPipeline.fitScore}/100</p>
              )}
              {selectedPipeline.notes && (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{selectedPipeline.notes}</p>
              )}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function FirmRow({ firm, onOpen }: { firm: InvestorFirm; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start justify-between rounded-xl border bg-card px-4 py-3 text-left hover:bg-muted/40"
    >
      <div>
        <div className="font-medium">{firm.name}</div>
        {firm.stageFocus && <div className="mt-1 text-xs text-muted-foreground">{firm.stageFocus}</div>}
      </div>
    </button>
  );
}

function ContactRow({
  contact,
  firmName,
  onOpen,
}: {
  contact: InvestorContact;
  firmName?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start justify-between rounded-xl border bg-card px-4 py-3 text-left hover:bg-muted/40"
    >
      <div>
        <div className="font-medium">{contact.fullName}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {[contact.title, firmName, contact.email].filter(Boolean).join(" · ")}
        </div>
      </div>
    </button>
  );
}
