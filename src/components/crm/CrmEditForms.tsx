"use client";

import { useState } from "react";
import type { CrmContact, CrmDeal, CrmCompany, CrmPipelineStage } from "@/lib/crm/types";
import {
  archiveCrmCompany,
  archiveCrmContact,
  archiveCrmDeal,
  patchCrmCompany,
  patchCrmContact,
  patchCrmDeal,
} from "@/lib/crm/client";
import { Button } from "@/components/ui";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-ink/30";

export function CrmContactEditForm({
  contact,
  workspaceId,
  onSaved,
  onArchived,
}: {
  contact: CrmContact;
  workspaceId: string;
  onSaved: () => void;
  onArchived: () => void;
}) {
  const [firstName, setFirstName] = useState(contact.firstName);
  const [lastName, setLastName] = useState(contact.lastName ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [title, setTitle] = useState(contact.title ?? "");
  const [companyName, setCompanyName] = useState(contact.companyName ?? "");
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await patchCrmContact(workspaceId, contact.id, {
        firstName,
        lastName: lastName || null,
        email: email || null,
        phone: phone || null,
        title: title || null,
        companyName: companyName || null,
        notes: notes || null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!confirm("Delete this contact from CRM?")) return;
    setSaving(true);
    try {
      await archiveCrmContact(workspaceId, contact.id);
      onArchived();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <CrmEditShell error={error} onSave={() => void save()} onArchive={() => void archive()} saving={saving}>
      <Field label="First name" value={firstName} onChange={setFirstName} />
      <Field label="Last name" value={lastName} onChange={setLastName} />
      <Field label="Email" value={email} onChange={setEmail} />
      <Field label="Phone" value={phone} onChange={setPhone} />
      <Field label="Title" value={title} onChange={setTitle} />
      <Field label="Company" value={companyName} onChange={setCompanyName} />
      <label className="block text-xs">
        <span className="font-medium text-ink-2">Notes</span>
        <textarea
          className={`${inputClass} mt-1 min-h-[80px]`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
    </CrmEditShell>
  );
}

export function CrmCompanyEditForm({
  company,
  workspaceId,
  onSaved,
  onArchived,
}: {
  company: CrmCompany;
  workspaceId: string;
  onSaved: () => void;
  onArchived: () => void;
}) {
  const [name, setName] = useState(company.name);
  const [domain, setDomain] = useState(company.domain ?? "");
  const [industry, setIndustry] = useState(company.industry ?? "");
  const [notes, setNotes] = useState(company.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <CrmEditShell
      error={error}
      saving={saving}
      onSave={() => {
        void (async () => {
          setSaving(true);
          setError(null);
          try {
            await patchCrmCompany(workspaceId, company.id, {
              name,
              domain: domain || null,
              industry: industry || null,
              notes: notes || null,
            });
            onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Save failed.");
          } finally {
            setSaving(false);
          }
        })();
      }}
      onArchive={() => {
        void (async () => {
          if (!confirm("Delete this company?")) return;
          setSaving(true);
          try {
            await archiveCrmCompany(workspaceId, company.id);
            onArchived();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Delete failed.");
          } finally {
            setSaving(false);
          }
        })();
      }}
    >
      <Field label="Name" value={name} onChange={setName} />
      <Field label="Domain" value={domain} onChange={setDomain} />
      <Field label="Industry" value={industry} onChange={setIndustry} />
      <label className="block text-xs">
        <span className="font-medium text-ink-2">Notes</span>
        <textarea
          className={`${inputClass} mt-1 min-h-[80px]`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
    </CrmEditShell>
  );
}

export function CrmDealEditForm({
  deal,
  stages,
  workspaceId,
  onSaved,
  onArchived,
}: {
  deal: CrmDeal;
  stages: CrmPipelineStage[];
  workspaceId: string;
  onSaved: () => void;
  onArchived: () => void;
}) {
  const [name, setName] = useState(deal.name);
  const [amount, setAmount] = useState(deal.amount != null ? String(deal.amount) : "");
  const [stageName, setStageName] = useState(deal.stageName);
  const [notes, setNotes] = useState(deal.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <CrmEditShell
      error={error}
      saving={saving}
      onSave={() => {
        void (async () => {
          setSaving(true);
          setError(null);
          try {
            await patchCrmDeal(workspaceId, deal.id, {
              name,
              amount: amount.trim() ? Number(amount) : null,
              stageName,
              notes: notes || null,
            });
            onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Save failed.");
          } finally {
            setSaving(false);
          }
        })();
      }}
      onArchive={() => {
        void (async () => {
          if (!confirm("Delete this deal?")) return;
          setSaving(true);
          try {
            await archiveCrmDeal(workspaceId, deal.id);
            onArchived();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Delete failed.");
          } finally {
            setSaving(false);
          }
        })();
      }}
    >
      <Field label="Deal name" value={name} onChange={setName} />
      <Field label="Amount" value={amount} onChange={setAmount} type="number" />
      <label className="block text-xs">
        <span className="font-medium text-ink-2">Stage</span>
        <select
          className={`${inputClass} mt-1`}
          value={stageName}
          onChange={(e) => setStageName(e.target.value)}
        >
          {stages.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        <span className="font-medium text-ink-2">Notes</span>
        <textarea
          className={`${inputClass} mt-1 min-h-[80px]`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
    </CrmEditShell>
  );
}

function CrmEditShell({
  children,
  error,
  saving,
  onSave,
  onArchive,
}: {
  children: React.ReactNode;
  error: string | null;
  saving: boolean;
  onSave: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="mt-6 space-y-3 border-t border-border pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Edit record</h3>
      <div className="space-y-3">{children}</div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onArchive} disabled={saving}>
          Delete
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-ink-2">{label}</span>
      <input
        type={type}
        className={`${inputClass} mt-1`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
