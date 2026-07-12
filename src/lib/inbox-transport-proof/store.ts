/**
 * Slice 0 local file store. REMOVABLE.
 * Stores webhook events and CLI run results under .tmp/inbox-transport-proof/.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { getProofStoreDir } from "./config";

export type ProofEventStatus = "accepted" | "duplicate" | "rejected";

export type StoredWebhookEvent = {
  storedAt: string;
  status: ProofEventStatus;
  svixId: string | null;
  eventType: string | null;
  providerEmailId: string | null;
  /** Raw verified payload (no secrets). */
  payload: unknown;
  note?: string;
};

export type StoredOutbound = {
  storedAt: string;
  providerId: string | null;
  from: string;
  to: string[];
  subject: string;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  references: string | null;
  error?: string;
};

export type ChecklistStatus = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";

export type ChecklistItem = {
  id: string;
  title: string;
  status: ChecklistStatus;
  evidence?: string;
  updatedAt?: string;
};

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: "dns-domain", title: "inbox.adehq.com exists in Resend with receiving", status: "NOT_RUN" },
  { id: "dns-mx-spf-dkim", title: "MX + SPF + DKIM records configured", status: "NOT_RUN" },
  { id: "webhook-verify", title: "Webhook signature verification accepts valid / rejects invalid", status: "NOT_RUN" },
  { id: "inbound-gmail", title: "Inbound delivery from Gmail", status: "NOT_RUN" },
  { id: "inbound-outlook", title: "Inbound delivery from Outlook", status: "NOT_RUN" },
  { id: "catchall-routing", title: "Catch-all routing across multiple local-parts", status: "NOT_RUN" },
  { id: "outbound-send", title: "Outbound send via Resend from inbox domain", status: "NOT_RUN" },
  { id: "outbound-attach", title: "Outbound attachment send", status: "NOT_RUN" },
  { id: "inbound-attach", title: "Inbound attachment fetch via Receiving API", status: "NOT_RUN" },
  { id: "threading-headers", title: "Custom Message-ID / In-Reply-To / References on send", status: "NOT_RUN" },
  { id: "reply-thread-gmail", title: "Reply stays in same Gmail conversation", status: "NOT_RUN" },
  { id: "reply-thread-outlook", title: "Reply stays in same Outlook conversation", status: "NOT_RUN" },
  { id: "webhook-replay", title: "Replayed webhook does not duplicate (idempotent by svix-id)", status: "NOT_RUN" },
  { id: "event-delivered", title: "email.delivered webhook observed", status: "NOT_RUN" },
  { id: "event-bounced", title: "email.bounced webhook observed", status: "NOT_RUN" },
  { id: "event-complained", title: "email.complained webhook observed", status: "NOT_RUN" },
];

function ensureDir(): string {
  const dir = getProofStoreDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function eventsPath(): string {
  return join(ensureDir(), "webhook-events.jsonl");
}

function outboundsPath(): string {
  return join(ensureDir(), "outbounds.jsonl");
}

function checklistPath(): string {
  return join(ensureDir(), "checklist.json");
}

function seenSvixPath(): string {
  return join(ensureDir(), "seen-svix-ids.json");
}

export function appendJsonl(path: string, row: unknown): void {
  ensureDir();
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

export function loadSeenSvixIds(): Set<string> {
  const path = seenSvixPath();
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as string[];
    return new Set(data);
  } catch {
    return new Set();
  }
}

export function markSvixSeen(svixId: string): boolean {
  const seen = loadSeenSvixIds();
  if (seen.has(svixId)) return false;
  seen.add(svixId);
  writeFileSync(seenSvixPath(), JSON.stringify([...seen], null, 2), "utf8");
  return true;
}

export function storeWebhookEvent(event: StoredWebhookEvent): void {
  appendJsonl(eventsPath(), event);
}

export function listWebhookEvents(): StoredWebhookEvent[] {
  return readJsonl<StoredWebhookEvent>(eventsPath());
}

export function storeOutbound(row: StoredOutbound): void {
  appendJsonl(outboundsPath(), row);
}

export function listOutbounds(): StoredOutbound[] {
  return readJsonl<StoredOutbound>(outboundsPath());
}

export function loadChecklist(): ChecklistItem[] {
  const path = checklistPath();
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULT_CHECKLIST, null, 2), "utf8");
    return structuredClone(DEFAULT_CHECKLIST);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ChecklistItem[];
  } catch {
    return structuredClone(DEFAULT_CHECKLIST);
  }
}

export function updateChecklist(
  id: string,
  status: ChecklistStatus,
  evidence?: string,
): ChecklistItem[] {
  const items = loadChecklist();
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) throw new Error(`Unknown checklist id: ${id}`);
  items[idx] = {
    ...items[idx],
    status,
    evidence: evidence ?? items[idx].evidence,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(checklistPath(), JSON.stringify(items, null, 2), "utf8");
  return items;
}

export function listStoreFiles(): string[] {
  const dir = ensureDir();
  return readdirSync(dir);
}

export function getEventsFilePath(): string {
  return eventsPath();
}
