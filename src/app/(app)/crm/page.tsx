"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { supabase } from "@/lib/supabase/client";
import { PageContainer, PageHeader } from "@/components/Page";
import { EmptyState } from "@/components/States";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { fetchCrmData, formatDealAmount, patchCrmDeal, createCrmContact, createCrmCompany, createCrmDeal } from "@/lib/crm/client";
import type { CrmDeal, CrmListPayload } from "@/lib/crm/types";
import { CrmContactDetail, CrmDealDetail, CrmDetailDrawer } from "@/components/crm/CrmPanels";
import { CrmCompanyEditForm, CrmContactEditForm, CrmDealEditForm } from "@/components/crm/CrmEditForms";
import {
  ColumnEmpty,
  KanbanColumn,
  ProgressMeter,
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
  Briefcase,
  Building2,
  DollarSign,
  Mail,
  RefreshCw,
  Target,
  Trophy,
  Users,
} from "lucide-react";

type Tab = "pipeline" | "contacts" | "companies";

const STAGE_TONES: Tone[] = ["slate", "sky", "indigo", "violet", "emerald", "rose"];

export default function CrmPage() {
  const { state, backend } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = state.workspace.id;

  const [data, setData] = useState<CrmListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pipeline");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [dragDealId, setDragDealId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<"contact" | "company" | "deal">("contact");
  const [createBusy, setCreateBusy] = useState(false);
  const [createForm, setCreateForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    companyName: "",
    name: "",
    amount: "",
    stageName: "",
  });

  const selectedContactId = searchParams.get("contact");
  const selectedDealId = searchParams.get("deal");
  const selectedCompanyId = searchParams.get("company");

  const load = useCallback(async () => {
    if (backend !== "supabase" || !workspaceId) {
      setData({
        contacts: [],
        companies: [],
        deals: [],
        stages: [],
        summary: { contactCount: 0, companyCount: 0, openDealCount: 0, openPipelineValue: 0, wonDealCount: 0 },
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await fetchCrmData({ workspaceId, query: query || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load CRM.");
    } finally {
      setLoading(false);
    }
  }, [backend, workspaceId, query]);

  useEffect(() => { void load(); }, [load]);

  // Live-update the board when an AI employee (or another tab) writes a CRM
  // record via tool call — otherwise this page only ever reflects state as of
  // the last mount/search, and a user has to hard-navigate to see new records.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (backend !== "supabase" || !workspaceId) return;

    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void loadRef.current(), 250);
    };

    let channel = supabase.channel(`crm:${workspaceId}`);
    for (const table of ["crm_companies", "crm_contacts", "crm_deals", "crm_pipeline_stages"]) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` },
        refresh,
      );
    }
    void channel.subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [backend, workspaceId]);

  const selectedContact = useMemo(() => data?.contacts.find((c) => c.id === selectedContactId) ?? null, [data, selectedContactId]);
  const selectedDeal = useMemo(() => data?.deals.find((d) => d.id === selectedDealId) ?? null, [data, selectedDealId]);
  const selectedCompany = useMemo(() => data?.companies.find((c) => c.id === selectedCompanyId) ?? null, [data, selectedCompanyId]);

  const openDrawer = (params: { contact?: string; deal?: string; company?: string }) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("contact"); next.delete("deal"); next.delete("company");
    if (params.contact) next.set("contact", params.contact);
    if (params.deal) next.set("deal", params.deal);
    if (params.company) next.set("company", params.company);
    router.replace(`/crm?${next.toString()}`, { scroll: false });
  };
  const closeDrawer = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("contact"); next.delete("deal"); next.delete("company");
    router.replace(next.toString() ? `/crm?${next}` : "/crm", { scroll: false });
  };

  const dealsByStage = useMemo(() => {
    const map = new Map<string, CrmDeal[]>();
    if (!data) return map;
    for (const stage of data.stages) map.set(stage.id, []);
    for (const deal of data.deals) {
      const key = deal.stageId ?? data.stages[0]?.id ?? "unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(deal);
    }
    return map;
  }, [data]);

  const stageValue = (deals: CrmDeal[]) => deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const currency = data?.deals.find((d) => d.currency)?.currency ?? "USD";
  const winRate = data && data.summary.wonDealCount + data.summary.openDealCount > 0
    ? Math.round((data.summary.wonDealCount / (data.summary.wonDealCount + data.summary.openDealCount)) * 100)
    : 0;

  const stats = useMemo<StatDef[]>(() => {
    const s = data?.summary;
    return [
      { label: "Contacts", value: s?.contactCount ?? 0, icon: Users, tone: "accent", hint: `${s?.companyCount ?? 0} companies` },
      { label: "Open pipeline", value: formatDealAmount(s?.openPipelineValue ?? 0, currency), icon: DollarSign, tone: "emerald", hint: `${s?.openDealCount ?? 0} open deals` },
      { label: "Won deals", value: s?.wonDealCount ?? 0, icon: Trophy, tone: "amber", hint: "Closed & won" },
      { label: "Win rate", value: `${winRate}%`, icon: Target, tone: winRate >= 40 ? "violet" : "slate", hint: "Won vs open" },
    ];
  }, [data, currency, winRate]);

  const moveDeal = async (dealId: string, stageId: string) => {
    if (!data || backend !== "supabase") return;
    const stage = data.stages.find((s) => s.id === stageId);
    if (!stage) return;
    const prev = data;
    setData({
      ...data,
      deals: data.deals.map((d) =>
        d.id === dealId
          ? { ...d, stageId: stage.id, stageName: stage.name, status: stage.isWon ? "won" : stage.isLost ? "lost" : "open" }
          : d,
      ),
    });
    try {
      await patchCrmDeal(workspaceId, dealId, { stageName: stage.name });
    } catch {
      setData(prev);
      setError("Could not move deal. Try again.");
    }
  };

  const handleCreate = async () => {
    if (backend !== "supabase") return;
    setCreateBusy(true);
    setError(null);
    try {
      if (createKind === "contact") {
        await createCrmContact(workspaceId, {
          firstName: createForm.firstName,
          lastName: createForm.lastName || undefined,
          email: createForm.email || undefined,
          companyName: createForm.companyName || undefined,
        });
        setTab("contacts");
      } else if (createKind === "company") {
        await createCrmCompany(workspaceId, { name: createForm.name });
        setTab("companies");
      } else {
        await createCrmDeal(workspaceId, {
          name: createForm.name,
          amount: createForm.amount ? Number(createForm.amount) : undefined,
          companyName: createForm.companyName || undefined,
          stageName: createForm.stageName || undefined,
        });
        setTab("pipeline");
      }
      setCreateOpen(false);
      setCreateForm({
        firstName: "",
        lastName: "",
        email: "",
        companyName: "",
        name: "",
        amount: "",
        stageName: "",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create record.");
    } finally {
      setCreateBusy(false);
    }
  };

  const isEmpty = !loading && !error && data && data.contacts.length + data.deals.length + data.companies.length === 0;

  return (
    <PageContainer wide>
      <PageHeader
        title="CRM"
        subtitle="Contacts, companies, and a live deal pipeline your AI employees build for you. Drag deals to move stages — no external CRM required."
        icon={<Briefcase className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setCreateOpen(true)} disabled={backend !== "supabase"}>
              Add record
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
            Connect a live workspace to see CRM records. In demo mode, ask a Sales employee to create contacts and deals in a room.
          </div>
        )}

        {data && <StatGrid stats={stats} className="mb-5" />}

        <Toolbar>
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { id: "pipeline", label: "Pipeline", icon: Briefcase, count: data?.deals.length },
              { id: "contacts", label: "Contacts", icon: Users, count: data?.contacts.length },
              { id: "companies", label: "Companies", icon: Building2, count: data?.companies.length },
            ]}
          />
          <SearchInput
            value={search}
            onChange={setSearch}
            onSubmit={() => setQuery(search.trim())}
            placeholder="Search CRM…"
            className="w-full sm:max-w-xs"
          />
        </Toolbar>

        {loading && <p className="text-sm text-ink-3">Loading CRM…</p>}
        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/8 px-4 py-3 text-sm text-rose-700">{error}</div>}

        {isEmpty && (
          <div className="rounded-2xl border border-border bg-surface">
            <EmptyState
              icon={Briefcase}
              title="No CRM records yet"
              description="Ask a Sales employee to add a contact, create a deal, and draft a follow-up email. Records appear here automatically."
            />
          </div>
        )}

        {!loading && !error && data && !isEmpty && tab === "pipeline" && (
          <div className="flex gap-3 overflow-x-auto pb-3">
            {data.stages.map((stage, i) => {
              const stageDeals = dealsByStage.get(stage.id) ?? [];
              const tone = stage.isWon ? "emerald" : stage.isLost ? "rose" : STAGE_TONES[i % STAGE_TONES.length];
              return (
                <KanbanColumn
                  key={stage.id}
                  title={stage.name}
                  tone={tone}
                  count={stageDeals.length}
                  active={overStage === stage.id && dragDealId !== null}
                  onDragOver={(e) => { e.preventDefault(); setOverStage(stage.id); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain") || dragDealId;
                    if (id) void moveDeal(id, stage.id);
                    setDragDealId(null); setOverStage(null);
                  }}
                  footer={<span className="font-semibold text-ink-2">{formatDealAmount(stageValue(stageDeals), currency)}</span>}
                >
                  {stageDeals.length === 0 ? (
                    <ColumnEmpty label="No deals" />
                  ) : (
                    stageDeals.map((deal) => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        currency={currency}
                        dragging={dragDealId === deal.id}
                        onDragStart={(e) => { setDragDealId(deal.id); e.dataTransfer.setData("text/plain", deal.id); }}
                        onDragEnd={() => { setDragDealId(null); setOverStage(null); }}
                        onClick={() => openDrawer({ deal: deal.id })}
                        contactName={data.contacts.find((c) => c.id === deal.contactId)?.fullName}
                      />
                    ))
                  )}
                </KanbanColumn>
              );
            })}
          </div>
        )}

        {!loading && !error && data && !isEmpty && tab === "contacts" && (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-ink-3">
                    <th className="px-4 py-2.5 font-semibold">Name</th>
                    <th className="px-4 py-2.5 font-semibold">Title</th>
                    <th className="px-4 py-2.5 font-semibold">Company</th>
                    <th className="px-4 py-2.5 font-semibold">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {data.contacts.map((c) => (
                    <tr key={c.id} onClick={() => openDrawer({ contact: c.id })} className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-[11px] font-bold text-accent">
                            {c.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                          </span>
                          <span className="font-medium text-ink">{c.fullName}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-2">{c.title ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-2">{c.companyName ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-3">
                        {c.email ? <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{c.email}</span> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && !error && data && !isEmpty && tab === "companies" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.companies.map((company) => {
              const dealCount = data.deals.filter((d) => d.companyId === company.id).length;
              return (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => openDrawer({ company: company.id })}
                  className="group rounded-2xl border border-border bg-surface p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lift"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500/20 to-violet-500/10 text-accent">
                      <Building2 className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink">{company.name}</div>
                      {company.industry && <div className="truncate text-xs text-ink-3">{company.industry}</div>}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-3">
                    {company.domain && <span className="truncate">{company.domain}</span>}
                    <span className="ml-auto rounded-md bg-ink/5 px-1.5 py-0.5 font-semibold text-ink-2">{dealCount} deals</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <IntegrationsStrip
          title="CRM integrations"
          ids={["hubspot", "salesforce", "pipedrive", "gmail", "outlook", "slack", "gsheets", "calendly", "zapier", "stripe"]}
        />
      </WorkspaceCanvas>

      <CrmDetailDrawer open={Boolean(selectedContact)} title={selectedContact?.fullName ?? "Contact"} subtitle={selectedContact?.companyName ?? undefined} onClose={closeDrawer}>
        {selectedContact && (
          <>
            <CrmContactDetail contact={selectedContact} />
            {backend === "supabase" && <CrmContactEditForm contact={selectedContact} workspaceId={workspaceId} onSaved={() => void load()} onArchived={closeDrawer} />}
          </>
        )}
      </CrmDetailDrawer>

      <CrmDetailDrawer open={Boolean(selectedDeal)} title={selectedDeal?.name ?? "Deal"} subtitle={selectedDeal?.stageName} onClose={closeDrawer}>
        {selectedDeal && (
          <>
            <CrmDealDetail
              deal={selectedDeal}
              contact={selectedDeal.contactId ? data?.contacts.find((c) => c.id === selectedDeal.contactId) : null}
              company={selectedDeal.companyId ? data?.companies.find((c) => c.id === selectedDeal.companyId) : null}
            />
            {backend === "supabase" && data && (
              <CrmDealEditForm deal={selectedDeal} stages={data.stages} workspaceId={workspaceId} onSaved={() => void load()} onArchived={closeDrawer} />
            )}
          </>
        )}
      </CrmDetailDrawer>

      <CrmDetailDrawer open={Boolean(selectedCompany)} title={selectedCompany?.name ?? "Company"} subtitle={selectedCompany?.industry ?? undefined} onClose={closeDrawer}>
        {selectedCompany && (
          <>
            <div className="space-y-3 text-sm text-ink-2">
              {selectedCompany.domain && <p>Domain: {selectedCompany.domain}</p>}
              {selectedCompany.notes && <p className="whitespace-pre-wrap">{selectedCompany.notes}</p>}
            </div>
            {backend === "supabase" && <CrmCompanyEditForm company={selectedCompany} workspaceId={workspaceId} onSaved={() => void load()} onArchived={closeDrawer} />}
          </>
        )}
      </CrmDetailDrawer>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)}>
        <ModalHeader title="Add CRM record" onClose={() => setCreateOpen(false)} />
        <div className="space-y-4 p-4">
          <div className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">
            {(["contact", "company", "deal"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setCreateKind(kind)}
                className={cn(
                  "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium capitalize transition-colors",
                  createKind === kind ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
                )}
              >
                {kind}
              </button>
            ))}
          </div>
          {createKind === "contact" ? (
            <div className="space-y-2">
              <input value={createForm.firstName} onChange={(e) => setCreateForm((f) => ({ ...f, firstName: e.target.value }))} placeholder="First name" className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
              <input value={createForm.lastName} onChange={(e) => setCreateForm((f) => ({ ...f, lastName: e.target.value }))} placeholder="Last name" className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
              <input value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
              <input value={createForm.companyName} onChange={(e) => setCreateForm((f) => ({ ...f, companyName: e.target.value }))} placeholder="Company" className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
            </div>
          ) : createKind === "company" ? (
            <input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} placeholder="Company name" className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
          ) : (
            <div className="space-y-2">
              <input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} placeholder="Deal name" className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
              <input value={createForm.amount} onChange={(e) => setCreateForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Amount" className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
              <input value={createForm.companyName} onChange={(e) => setCreateForm((f) => ({ ...f, companyName: e.target.value }))} placeholder="Company" className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
              <input value={createForm.stageName} onChange={(e) => setCreateForm((f) => ({ ...f, stageName: e.target.value }))} placeholder="Stage (e.g. Qualified)" className="w-full rounded-xl border border-border px-3 py-2 text-sm" />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={createBusy} onClick={() => void handleCreate()}>
              {createBusy ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}

function DealCard({
  deal,
  currency,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
  contactName,
}: {
  deal: CrmDeal;
  currency: string;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  contactName?: string;
}) {
  const statusTone: Tone = deal.status === "won" ? "emerald" : deal.status === "lost" ? "rose" : "accent";
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-xl border border-border bg-surface p-3 shadow-card transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lift",
        dragging && "rotate-1 opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 text-[13px] font-semibold leading-snug text-ink line-clamp-2">{deal.name}</p>
      </div>
      <div className="mt-2 text-[15px] font-bold text-emerald-600">{formatDealAmount(deal.amount, deal.currency || currency)}</div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {contactName ? (
          <span className="truncate text-[11px] text-ink-3">{contactName}</span>
        ) : (
          <span className="text-[11px] text-ink-3">No contact</span>
        )}
        <StatusPill tone={statusTone} label={deal.status} dot={false} />
      </div>
      {deal.expectedCloseDate && (
        <div className="mt-2">
          <ProgressMeter
            value={Math.min(100, Math.max(8, 100 - Math.abs(new Date(deal.expectedCloseDate).getTime() - Date.now()) / 86_400_000 / 90 * 100))}
            tone={statusTone}
            height="h-1"
          />
        </div>
      )}
    </div>
  );
}
