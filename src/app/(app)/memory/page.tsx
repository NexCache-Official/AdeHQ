"use client";

import { useState } from "react";
import { useStore } from "@/lib/demo-store";
import { PageContainer, PageHeader } from "@/components/Page";
import { MemoryCard } from "@/components/MemoryCard";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { EmptyState } from "@/components/States";
import { cn } from "@/lib/utils";
import { MemoryStatus, MemoryType } from "@/lib/types";
import { BrainCircuit, Plus, Search } from "lucide-react";

const TYPES: (MemoryType | "all")[] = ["all", "decision", "research", "architecture", "preference", "instruction", "general"];
const STATUSES: (MemoryStatus | "all")[] = ["all", "draft", "approved", "pinned", "superseded"];

export default function MemoryPage() {
  const { state } = useStore();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<MemoryType | "all">("all");
  const [status, setStatus] = useState<MemoryStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = state.memory.filter((m) => {
    if (type !== "all" && m.type !== type) return false;
    if (status !== "all" && m.status !== status) return false;
    if (query && !`${m.title} ${m.content}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const byRoom = state.rooms
    .map((r) => ({ room: r, items: filtered.filter((m) => m.roomId === r.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <PageContainer wide>
      <PageHeader
        title="Memory"
        subtitle="Your project brain — decisions, research, and notes your AI employees rely on."
        icon={<BrainCircuit className="h-5 w-5" />}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New memory
          </Button>
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memory…" className="input-field !pl-9" />
        </div>
        <select className="input-field sm:w-40" value={type} onChange={(e) => setType(e.target.value as MemoryType | "all")}>
          {TYPES.map((t) => <option key={t} value={t}>{t === "all" ? "All types" : t}</option>)}
        </select>
        <select className="input-field sm:w-40" value={status} onChange={(e) => setStatus(e.target.value as MemoryStatus | "all")}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={BrainCircuit} title="No memory found" description="Try a different filter, or ask an employee to save a decision." action={{ label: "New memory", onClick: () => setCreateOpen(true) }} />
      ) : (
        <div className="space-y-8">
          {byRoom.map(({ room, items }) => (
            <section key={room.id}>
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: room.accent }} />
                <h2 className="text-sm font-semibold text-slate-900">{room.name}</h2>
                <span className="text-xs text-slate-500">{items.length}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((m) => <MemoryCard key={m.id} memory={m} />)}
              </div>
            </section>
          ))}
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
  const [type, setType] = useState<MemoryType>("decision");
  const [roomId, setRoomId] = useState(state.rooms[0]?.id ?? "");

  const create = () => {
    if (!title.trim() || !roomId) return;
    actions.createMemory({
      roomId,
      title: title.trim(),
      content,
      type,
      status: "approved",
      createdByType: "human",
      createdById: state.user?.id ?? "user-shubham",
    });
    setTitle("");
    setContent("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader title="Create a memory" subtitle="Add a decision or note to your project brain." onClose={onClose} icon={<BrainCircuit className="h-5 w-5" />} />
      <div className="space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Title</span>
          <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Launch as a Godot distribution" autoFocus />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Content</span>
          <textarea className="input-field min-h-[100px] resize-none" value={content} onChange={(e) => setContent(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Type</span>
            <select className="input-field" value={type} onChange={(e) => setType(e.target.value as MemoryType)}>
              {TYPES.filter((t) => t !== "all").map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Room</span>
            <select className="input-field" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {state.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={create} disabled={!title.trim()}>Save memory</Button>
      </div>
    </Modal>
  );
}
