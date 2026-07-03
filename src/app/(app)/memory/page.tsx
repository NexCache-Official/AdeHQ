"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/demo-store";
import { MEMORY_UPDATED_EVENT } from "@/lib/topic-summary/client";
import type { MemoryEntry } from "@/lib/types";
import { MEMORY_CATEGORIES, categoryToLegacyType, normalizeCategory, type MemoryScope } from "@/lib/memory/categories";
import { scopeFilterMatches } from "@/lib/memory/attribution";
import { PageContainer, PageHeader } from "@/components/Page";
import { MemoryCard } from "@/components/MemoryCard";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { BrainCircuit, Plus, Search } from "lucide-react";
import { MemoryStatus } from "@/lib/types";
import { isActiveMemory } from "@/lib/memory/active-filter";

const STATUSES: (MemoryStatus | "all")[] = ["all", "draft", "approved", "pinned", "archived", "superseded"];
const SCOPES: { id: MemoryScope | "dm" | "all"; label: string }[] = [
  { id: "all", label: "All scopes" },
  { id: "workspace", label: "Workspace" },
  { id: "room", label: "Room" },
  { id: "topic", label: "Topic" },
  { id: "dm", label: "Employee DM" },
  { id: "employee_profile", label: "Employee profile" },
];
const SOURCE_TYPES = ["all", "message", "topic_summary", "file", "artifact", "ai_suggestion", "manual"] as const;

type GroupMode = "category" | "recent";

function dedupeMemories(items: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>();
  const out: MemoryEntry[] = [];
  for (const item of items) {
    const key = item.dedupeKey ?? item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export default function MemoryPage() {
  const { state, actions } = useStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<MemoryStatus | "all">("all");
  const [scope, setScope] = useState<MemoryScope | "dm" | "all">("all");
  const [sourceType, setSourceType] = useState<(typeof SOURCE_TYPES)[number]>("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("category");
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const onMemoryUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ memory?: MemoryEntry }>).detail;
      if (detail?.memory) actions.mergeMemoryEntry(detail.memory);
      setRefreshKey((k) => k + 1);
    };
    window.addEventListener(MEMORY_UPDATED_EVENT, onMemoryUpdated);
    return () => window.removeEventListener(MEMORY_UPDATED_EVENT, onMemoryUpdated);
  }, [actions]);

  const filtered = useMemo(() => {
    void refreshKey;
    return dedupeMemories(
      state.memory.filter((m) => {
        if (status === "all") {
          if (!isActiveMemory(m)) return false;
        } else if (m.status !== status) {
          return false;
        }
        if (category !== "all" && normalizeCategory(m.category) !== category) return false;
        if (!scopeFilterMatches(m, scope)) return false;
        if (sourceType !== "all" && m.sourceType !== sourceType) return false;
        if (employeeId !== "all") {
          const matches =
            m.suggestedById === employeeId ||
            m.sourceEmployeeId === employeeId ||
            m.createdById === employeeId;
          if (!matches) return false;
        }
        if (query) {
          const hay = `${m.title} ${m.content} ${(m.tags ?? []).join(" ")}`.toLowerCase();
          if (!hay.includes(query.toLowerCase())) return false;
        }
        return true;
      }),
    );
  }, [state.memory, status, category, scope, sourceType, employeeId, query, refreshKey]);

  const pinned = filtered.filter((m) => m.status === "pinned");
  const recent = [...filtered]
    .sort((a, b) => +new Date(b.updatedAt ?? b.createdAt) - +new Date(a.updatedAt ?? a.createdAt))
    .slice(0, 24);

  const byCategory = useMemo(() => {
    const map = new Map<string, MemoryEntry[]>();
    for (const item of filtered) {
      const key = normalizeCategory(item.category);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <PageContainer wide>
      <PageHeader
        title="Memory"
        subtitle="Reusable context your AI employees can rely on."
        icon={<BrainCircuit className="h-5 w-5" />}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New memory
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memory…"
            className="input-field !pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input-field w-auto min-w-[9rem]" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            {SCOPES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <select className="input-field w-auto min-w-[10rem]" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select className="input-field w-auto min-w-[8rem]" value={status} onChange={(e) => setStatus(e.target.value as MemoryStatus | "all")}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>
            ))}
          </select>
          <select className="input-field w-auto min-w-[9rem]" value={sourceType} onChange={(e) => setSourceType(e.target.value as typeof sourceType)}>
            {SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>{s === "all" ? "All sources" : s.replace(/_/g, " ")}</option>
            ))}
          </select>
          <select className="input-field w-auto min-w-[9rem]" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="all">All people</option>
            {state.employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <select className="input-field w-auto min-w-[8rem]" value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupMode)}>
            <option value="category">By category</option>
            <option value="recent">Recent</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={BrainCircuit}
          title="No memory found"
          description="Try a different filter, or save context from a topic summary or chat suggestion."
          action={{ label: "New memory", onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="space-y-8">
          {pinned.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Pinned</h2>
              <div className="grid gap-2 lg:grid-cols-2">
                {pinned.map((m) => (
                  <MemoryCard key={m.id} memory={m} compact />
                ))}
              </div>
            </section>
          )}

          {groupMode === "recent" ? (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Recent</h2>
              <div className="grid gap-2 lg:grid-cols-2">
                {recent.map((m) => (
                  <MemoryCard key={m.id} memory={m} compact />
                ))}
              </div>
            </section>
          ) : (
            byCategory.map(([cat, items]) => (
              <section key={cat}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                  {cat} <span className="font-normal text-ink-3">({items.length})</span>
                </h2>
                <div className="grid gap-2 lg:grid-cols-2">
                  {items.map((m) => (
                    <MemoryCard key={m.id} memory={m} compact />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}

      <CreateMemoryModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </PageContainer>
  );
}

function CreateMemoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, actions } = useStore();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>("Decision");
  const [roomId, setRoomId] = useState(state.rooms.find((r) => r.kind === "room")?.id ?? state.rooms[0]?.id ?? "");

  const create = () => {
    if (!title.trim() || !roomId) return;
    actions.createMemory({
      roomId,
      title: title.trim(),
      content: content.trim(),
      type: categoryToLegacyType(normalizeCategory(category)),
      status: "approved",
      createdByType: "human",
      createdById: state.user?.id ?? "user",
      category: normalizeCategory(category),
      scope: "room",
      tags: [],
      sourceType: "manual",
      savedByUserId: state.user?.id,
    });
    setTitle("");
    setContent("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader title="Create memory" subtitle="Add reusable context for your AI employees." onClose={onClose} icon={<BrainCircuit className="h-5 w-5" />} />
      <div className="space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-3">Title</span>
          <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short, specific title" autoFocus />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-3">Content</span>
          <textarea className="input-field min-h-[100px] resize-none" value={content} onChange={(e) => setContent(e.target.value)} placeholder="1–3 sentences of reusable context" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Category</span>
            <select className="input-field" value={category} onChange={(e) => setCategory(e.target.value)}>
              {MEMORY_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Room</span>
            <select className="input-field" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {state.rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={create} disabled={!title.trim()}>Save memory</Button>
      </div>
    </Modal>
  );
}
