"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { PageContainer, PageHeader } from "@/components/Page";
import { EmptyState } from "@/components/States";
import { Button } from "@/components/ui";
import { fetchCrmData } from "@/lib/crm/client";
import type { CrmCompany, CrmContact, CrmDeal, CrmListPayload } from "@/lib/crm/types";
import {
  CrmCompanyRow,
  CrmContactDetail,
  CrmContactRow,
  CrmDealCard,
  CrmDealDetail,
  CrmDetailDrawer,
  CrmSummaryStrip,
} from "@/components/crm/CrmPanels";
import {
  CrmCompanyEditForm,
  CrmContactEditForm,
  CrmDealEditForm,
} from "@/components/crm/CrmEditForms";
import { cn } from "@/lib/utils";
import { Briefcase, Building2, Search, Users } from "lucide-react";

type Tab = "pipeline" | "contacts" | "companies";

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
        summary: {
          contactCount: 0,
          companyCount: 0,
          openDealCount: 0,
          openPipelineValue: 0,
          wonDealCount: 0,
        },
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchCrmData({ workspaceId, query: query || undefined });
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load CRM.");
    } finally {
      setLoading(false);
    }
  }, [backend, workspaceId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedContact = useMemo(
    () => data?.contacts.find((c) => c.id === selectedContactId) ?? null,
    [data, selectedContactId],
  );
  const selectedDeal = useMemo(
    () => data?.deals.find((d) => d.id === selectedDealId) ?? null,
    [data, selectedDealId],
  );
  const selectedCompany = useMemo(
    () => data?.companies.find((c) => c.id === selectedCompanyId) ?? null,
    [data, selectedCompanyId],
  );

  const openDrawer = (params: { contact?: string; deal?: string; company?: string }) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("contact");
    next.delete("deal");
    next.delete("company");
    if (params.contact) next.set("contact", params.contact);
    if (params.deal) next.set("deal", params.deal);
    if (params.company) next.set("company", params.company);
    router.replace(`/crm?${next.toString()}`, { scroll: false });
  };

  const closeDrawer = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("contact");
    next.delete("deal");
    next.delete("company");
    router.replace(next.toString() ? `/crm?${next}` : "/crm", { scroll: false });
  };

  const dealsByStage = useMemo(() => {
    if (!data) return new Map<string, CrmDeal[]>();
    const map = new Map<string, CrmDeal[]>();
    for (const stage of data.stages) map.set(stage.id, []);
    for (const deal of data.deals) {
      const key = deal.stageId ?? data.stages[0]?.id ?? "unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(deal);
    }
    return map;
  }, [data]);

  return (
    <PageContainer wide>
      <PageHeader
        title="CRM"
        subtitle="Contacts, companies, and deals your AI employees create. Review, edit, and export — no external CRM required."
        icon={<Briefcase className="h-5 w-5" />}
        actions={
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {backend !== "supabase" && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Connect a live workspace to see CRM records. In demo mode, ask a Sales employee to create
          contacts and deals in a room.
        </div>
      )}

      {data && (
        <div className="mb-6">
          <CrmSummaryStrip
            contactCount={data.summary.contactCount}
            companyCount={data.summary.companyCount}
            openDealCount={data.summary.openDealCount}
            openPipelineValue={data.summary.openPipelineValue}
          />
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-xl border border-border bg-muted p-0.5">
          {(
            [
              ["pipeline", "Pipeline", Briefcase],
              ["contacts", "Contacts", Users],
              ["companies", "Companies", Building2],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors",
                tab === id ? "bg-surface text-ink shadow-sm" : "text-ink-3",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <form
          className="relative w-full sm:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search CRM…"
            className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-ink/30"
          />
        </form>
      </div>

      {loading && <p className="text-sm text-ink-3">Loading CRM…</p>}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && !error && data && data.contacts.length + data.deals.length === 0 && (
        <EmptyState
          icon={Briefcase}
          title="No CRM records yet"
          description="Ask a Sales employee to add a contact, create a deal, and draft a follow-up email. Records will appear here automatically."
        />
      )}

      {!loading && !error && data && tab === "pipeline" && data.deals.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {data.stages.map((stage) => {
            const stageDeals = dealsByStage.get(stage.id) ?? [];
            return (
              <div
                key={stage.id}
                className="flex w-[min(100%,280px)] shrink-0 flex-col rounded-2xl border border-border bg-muted/50 p-2.5"
              >
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-ink">{stage.name}</span>
                  <span className="text-xs text-ink-3">{stageDeals.length}</span>
                </div>
                <div className="space-y-2">
                  {stageDeals.map((deal) => (
                    <CrmDealCard
                      key={deal.id}
                      deal={deal}
                      compact
                      selected={deal.id === selectedDealId}
                      onClick={() => openDrawer({ deal: deal.id })}
                    />
                  ))}
                  {stageDeals.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-ink-3">No deals</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && data && tab === "contacts" && (
        <div className="grid gap-2">
          {data.contacts.map((contact) => (
            <CrmContactRow
              key={contact.id}
              contact={contact}
              selected={contact.id === selectedContactId}
              onClick={() => openDrawer({ contact: contact.id })}
            />
          ))}
        </div>
      )}

      {!loading && !error && data && tab === "companies" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {data.companies.map((company) => (
            <CrmCompanyRow
              key={company.id}
              company={company}
              selected={company.id === selectedCompanyId}
              onClick={() => openDrawer({ company: company.id })}
            />
          ))}
        </div>
      )}

      <CrmDetailDrawer
        open={Boolean(selectedContact)}
        title={selectedContact?.fullName ?? "Contact"}
        subtitle={selectedContact?.companyName ?? undefined}
        onClose={closeDrawer}
      >
        {selectedContact && (
          <>
            <CrmContactDetail contact={selectedContact} />
            {backend === "supabase" && (
              <CrmContactEditForm
                contact={selectedContact}
                workspaceId={workspaceId}
                onSaved={() => void load()}
                onArchived={closeDrawer}
              />
            )}
          </>
        )}
      </CrmDetailDrawer>

      <CrmDetailDrawer
        open={Boolean(selectedDeal)}
        title={selectedDeal?.name ?? "Deal"}
        subtitle={selectedDeal?.stageName}
        onClose={closeDrawer}
      >
        {selectedDeal && (
          <>
            <CrmDealDetail
              deal={selectedDeal}
              contact={
                selectedDeal.contactId
                  ? data?.contacts.find((c) => c.id === selectedDeal.contactId)
                  : null
              }
              company={
                selectedDeal.companyId
                  ? data?.companies.find((c) => c.id === selectedDeal.companyId)
                  : null
              }
            />
            {backend === "supabase" && data && (
              <CrmDealEditForm
                deal={selectedDeal}
                stages={data.stages}
                workspaceId={workspaceId}
                onSaved={() => void load()}
                onArchived={closeDrawer}
              />
            )}
          </>
        )}
      </CrmDetailDrawer>

      <CrmDetailDrawer
        open={Boolean(selectedCompany)}
        title={selectedCompany?.name ?? "Company"}
        subtitle={selectedCompany?.industry ?? undefined}
        onClose={closeDrawer}
      >
        {selectedCompany && (
          <>
            <div className="space-y-3 text-sm text-ink-2">
              {selectedCompany.domain && <p>Domain: {selectedCompany.domain}</p>}
              {selectedCompany.notes && (
                <p className="whitespace-pre-wrap">{selectedCompany.notes}</p>
              )}
            </div>
            {backend === "supabase" && (
              <CrmCompanyEditForm
                company={selectedCompany}
                workspaceId={workspaceId}
                onSaved={() => void load()}
                onArchived={closeDrawer}
              />
            )}
          </>
        )}
      </CrmDetailDrawer>
    </PageContainer>
  );
}
