"use client";

/**
 * Integrations strip — a compact, brand-colored row of connectable services
 * shown under each business app. Purely presentational for now (Phase 3/4
 * wires the real OAuth), but communicates the platform's reach: every app
 * can flow into the tools teams already use.
 */

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/demo-store";
import { cn } from "@/lib/utils";
import { Check, Link2, Plus, Sparkles } from "lucide-react";

const INTEGRATION_TOOL_ALIASES: Record<string, string> = {
  githubapp: "github",
  gcal: "calendar",
  gsheets: "google-drive",
  gdrive: "google-drive",
};

function integrationPrefsKey(workspaceId: string) {
  return `adehq:integration-prefs:${workspaceId}`;
}

export type IntegrationDef = {
  id: string;
  name: string;
  short: string; // 1-2 letter monogram
  color: string; // brand-ish hex
  connected?: boolean;
};

// A broad, recognizable catalog — apps subset what's relevant.
export const INTEGRATION_CATALOG: Record<string, IntegrationDef> = {
  hubspot: { id: "hubspot", name: "HubSpot", short: "H", color: "#ff7a59" },
  salesforce: { id: "salesforce", name: "Salesforce", short: "SF", color: "#00a1e0" },
  pipedrive: { id: "pipedrive", name: "Pipedrive", short: "P", color: "#1a1a1a" },
  gmail: { id: "gmail", name: "Gmail", short: "G", color: "#ea4335" },
  outlook: { id: "outlook", name: "Outlook", short: "O", color: "#0078d4" },
  slack: { id: "slack", name: "Slack", short: "S", color: "#611f69" },
  notion: { id: "notion", name: "Notion", short: "N", color: "#111111" },
  linear: { id: "linear", name: "Linear", short: "L", color: "#5e6ad2" },
  jira: { id: "jira", name: "Jira", short: "J", color: "#2684ff" },
  githubapp: { id: "githubapp", name: "GitHub", short: "GH", color: "#24292e" },
  zapier: { id: "zapier", name: "Zapier", short: "Z", color: "#ff4a00" },
  make: { id: "make", name: "Make", short: "M", color: "#6d00cc" },
  airtable: { id: "airtable", name: "Airtable", short: "A", color: "#fcb400" },
  gsheets: { id: "gsheets", name: "Google Sheets", short: "GS", color: "#0f9d58" },
  gcal: { id: "gcal", name: "Google Calendar", short: "GC", color: "#4285f4" },
  gdrive: { id: "gdrive", name: "Google Drive", short: "GD", color: "#1fa463" },
  buffer: { id: "buffer", name: "Buffer", short: "B", color: "#2c4bff" },
  linkedin: { id: "linkedin", name: "LinkedIn", short: "in", color: "#0a66c2" },
  meta: { id: "meta", name: "Meta", short: "M", color: "#0866ff" },
  x: { id: "x", name: "X", short: "X", color: "#111111" },
  mailchimp: { id: "mailchimp", name: "Mailchimp", short: "MC", color: "#ffe01b" },
  stripe: { id: "stripe", name: "Stripe", short: "St", color: "#635bff" },
  quickbooks: { id: "quickbooks", name: "QuickBooks", short: "QB", color: "#2ca01c" },
  docsend: { id: "docsend", name: "DocSend", short: "DS", color: "#1a73e8" },
  affinity: { id: "affinity", name: "Affinity", short: "Af", color: "#3855ff" },
  crunchbase: { id: "crunchbase", name: "Crunchbase", short: "CB", color: "#0288d1" },
  calendly: { id: "calendly", name: "Calendly", short: "Cy", color: "#006bff" },
  zoom: { id: "zoom", name: "Zoom", short: "Zm", color: "#2d8cff" },
  typeform: { id: "typeform", name: "Typeform", short: "Tf", color: "#262627" },
  webhook: { id: "webhook", name: "Webhooks", short: "{ }", color: "#64748b" },
};

function IntegrationChip({ def, onToggle }: { def: IntegrationDef; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={def.connected ? `${def.name} — connected` : `Connect ${def.name}`}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs font-medium transition-all",
        def.connected
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
          : "border-border bg-surface text-ink-2 hover:border-accent/40 hover:bg-accent-soft/50 hover:text-ink",
      )}
    >
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white shadow-sm"
        style={{ backgroundColor: def.color }}
      >
        {def.short}
      </span>
      <span>{def.name}</span>
      {def.connected ? (
        <Check className="h-3 w-3" />
      ) : (
        <Plus className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

export function IntegrationsStrip({
  title = "Integrations",
  ids,
  defaultConnected = [],
}: {
  title?: string;
  ids: string[];
  defaultConnected?: string[];
}) {
  const { state, actions, backend } = useStore();
  const workspaceId = state.workspace.id;
  const [localConnected, setLocalConnected] = useState<Set<string>>(new Set(defaultConnected));

  useEffect(() => {
    if (!workspaceId || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(integrationPrefsKey(workspaceId));
      if (raw) setLocalConnected(new Set(JSON.parse(raw) as string[]));
      else setLocalConnected(new Set(defaultConnected));
    } catch {
      setLocalConnected(new Set(defaultConnected));
    }
  }, [workspaceId, defaultConnected]);

  const resolveToolId = (integrationId: string): string | null => {
    const candidates = [integrationId, INTEGRATION_TOOL_ALIASES[integrationId]].filter(Boolean) as string[];
    for (const candidate of candidates) {
      if (state.tools.some((tool) => tool.id === candidate)) return candidate;
    }
    return null;
  };

  const connected = useMemo(() => {
    const set = new Set<string>();
    for (const id of ids) {
      const toolId = resolveToolId(id);
      const tool = toolId ? state.tools.find((t) => t.id === toolId) : null;
      if (tool && (tool.status === "connected" || tool.status === "mock")) {
        set.add(id);
      } else if (localConnected.has(id)) {
        set.add(id);
      }
    }
    return set;
  }, [ids, localConnected, state.tools]);

  const defs = ids.map((id) => INTEGRATION_CATALOG[id]).filter(Boolean);
  const count = connected.size;

  const persistLocal = (next: Set<string>) => {
    setLocalConnected(next);
    if (workspaceId && typeof window !== "undefined") {
      localStorage.setItem(integrationPrefsKey(workspaceId), JSON.stringify(Array.from(next)));
    }
  };

  const toggle = (id: string) => {
    const toolId = resolveToolId(id);
    if (toolId && backend === "supabase") {
      const tool = state.tools.find((t) => t.id === toolId);
      const nextStatus = tool?.status === "connected" ? "not_connected" : "connected";
      actions.setToolStatus(toolId, nextStatus);
      return;
    }
    persistLocal(
      (() => {
        const next = new Set(localConnected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      })(),
    );
  };

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-gradient-to-r from-accent-500/[0.06] to-transparent px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Link2 className="h-3.5 w-3.5" />
          </span>
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          <span className="rounded-md bg-ink/5 px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">
            {count}/{defs.length} connected
          </span>
        </div>
        <span className="hidden items-center gap-1 text-[11px] text-ink-3 sm:flex">
          <Sparkles className="h-3 w-3 text-accent" /> One-click, no code
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 p-3">
        {defs.map((def) => (
          <IntegrationChip
            key={def.id}
            def={{ ...def, connected: connected.has(def.id) }}
            onToggle={() => toggle(def.id)}
          />
        ))}
      </div>
    </div>
  );
}
