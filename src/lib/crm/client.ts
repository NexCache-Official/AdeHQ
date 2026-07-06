import type { CrmListPayload } from "./types";

export async function fetchCrmData(params: {
  workspaceId: string;
  query?: string;
}): Promise<CrmListPayload> {
  const search = new URLSearchParams({ workspaceId: params.workspaceId });
  if (params.query?.trim()) search.set("q", params.query.trim());

  const res = await fetch(`/api/crm?${search.toString()}`, { credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Unable to load CRM.");
  }
  return res.json() as Promise<CrmListPayload>;
}

export function formatDealAmount(amount: number | null, currency = "USD"): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export function crmEntityHref(type: "contact" | "deal" | "company", id: string): string {
  return `/crm?${type}=${encodeURIComponent(id)}`;
}

async function patchJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "CRM update failed.");
  }
  return res.json() as Promise<T>;
}

export async function patchCrmContact(
  workspaceId: string,
  contactId: string,
  patch: Record<string, unknown>,
) {
  return patchJson(`/api/crm/contacts/${contactId}`, { workspaceId, ...patch });
}

export async function patchCrmCompany(
  workspaceId: string,
  companyId: string,
  patch: Record<string, unknown>,
) {
  return patchJson(`/api/crm/companies/${companyId}`, { workspaceId, ...patch });
}

export async function patchCrmDeal(
  workspaceId: string,
  dealId: string,
  patch: Record<string, unknown>,
) {
  return patchJson(`/api/crm/deals/${dealId}`, { workspaceId, ...patch });
}

export async function archiveCrmContact(workspaceId: string, contactId: string) {
  return patchCrmContact(workspaceId, contactId, { archived: true });
}

export async function archiveCrmCompany(workspaceId: string, companyId: string) {
  return patchCrmCompany(workspaceId, companyId, { archived: true });
}

export async function archiveCrmDeal(workspaceId: string, dealId: string) {
  return patchCrmDeal(workspaceId, dealId, { archived: true });
}
