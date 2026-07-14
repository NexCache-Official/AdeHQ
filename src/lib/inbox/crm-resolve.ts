/**
 * Resolve inbound email senders to CRM contacts (auto-link existing only).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertWorkGraphEdge, EMAIL_WORK_RELATIONS } from "@/lib/inbox/work-graph";

export type ResolvedCrmContact = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  companyId: string | null;
};

export function normalizeEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  const match = trimmed.match(/<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/i);
  return match?.[1]?.toLowerCase() ?? (trimmed.includes("@") ? trimmed : null);
}

export async function findContactByEmail(
  client: SupabaseClient,
  workspaceId: string,
  email: string,
): Promise<ResolvedCrmContact | null> {
  const { data, error } = await client
    .from("crm_contacts")
    .select("id, full_name, email, phone, company_name, company_id")
    .eq("workspace_id", workspaceId)
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: String(data.id),
    fullName: String(data.full_name ?? ""),
    email: data.email ? String(data.email) : null,
    phone: data.phone ? String(data.phone) : null,
    companyName: data.company_name ? String(data.company_name) : null,
    companyId: data.company_id ? String(data.company_id) : null,
  };
}

/**
 * Auto-link thread to an existing CRM contact by sender email.
 * Never overwrites a human-set contact_id. Never creates contacts.
 */
export async function resolveAndLinkThreadContact(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    threadId: string;
    fromAddress: string | null;
    overwrite?: boolean;
  },
): Promise<{
  contact: ResolvedCrmContact | null;
  linked: boolean;
  suggestedEmail: string | null;
}> {
  const email = normalizeEmailAddress(params.fromAddress);
  if (!email) {
    return { contact: null, linked: false, suggestedEmail: null };
  }

  const { data: thread, error: threadError } = await client
    .from("email_threads")
    .select("contact_id")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.threadId)
    .maybeSingle();
  if (threadError) throw threadError;

  if (thread?.contact_id && !params.overwrite) {
    const existing = await client
      .from("crm_contacts")
      .select("id, full_name, email, phone, company_name, company_id")
      .eq("workspace_id", params.workspaceId)
      .eq("id", thread.contact_id)
      .maybeSingle();
    if (existing.data) {
      return {
        contact: {
          id: String(existing.data.id),
          fullName: String(existing.data.full_name ?? ""),
          email: existing.data.email ? String(existing.data.email) : null,
          phone: existing.data.phone ? String(existing.data.phone) : null,
          companyName: existing.data.company_name
            ? String(existing.data.company_name)
            : null,
          companyId: existing.data.company_id
            ? String(existing.data.company_id)
            : null,
        },
        linked: false,
        suggestedEmail: null,
      };
    }
  }

  const contact = await findContactByEmail(client, params.workspaceId, email);
  if (!contact) {
    return { contact: null, linked: false, suggestedEmail: email };
  }

  const { error: updateError } = await client
    .from("email_threads")
    .update({ contact_id: contact.id, updated_at: new Date().toISOString() })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.threadId);
  if (updateError) throw updateError;

  await upsertWorkGraphEdge(client, {
    workspaceId: params.workspaceId,
    fromObjectType: "email_thread",
    fromObjectId: params.threadId,
    relationType: EMAIL_WORK_RELATIONS.linkedContact,
    toObjectType: "crm_contact",
    toObjectId: contact.id,
    metadata: {
      sourceEmailThreadId: params.threadId,
      sourceSnapshotAt: new Date().toISOString(),
      matchedEmail: email,
      autoLinked: true,
    },
  });

  return { contact, linked: true, suggestedEmail: null };
}
