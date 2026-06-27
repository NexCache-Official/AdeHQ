"use client";

import { MemoryEntry, MemoryStatus, MemoryType } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { ActorChip } from "./ActorChip";
import { cn, timeAgo } from "@/lib/utils";
import { Pin, PinOff, Lightbulb, Microscope, Server, Heart, MessageSquareQuote, StickyNote, Check } from "lucide-react";

const TYPE_META: Record<MemoryType, { label: string; icon: typeof Pin; color: string }> = {
  decision: { label: "Decision", icon: Lightbulb, color: "text-amber-700" },
  research: { label: "Research", icon: Microscope, color: "text-cyan-700" },
  architecture: { label: "Architecture", icon: Server, color: "text-sky-700" },
  preference: { label: "Preference", icon: Heart, color: "text-pink-600" },
  instruction: { label: "Instruction", icon: MessageSquareQuote, color: "text-violet-700" },
  general: { label: "Note", icon: StickyNote, color: "text-slate-600" },
};

const STATUS_META: Record<MemoryStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-slate-500/15 text-slate-600" },
  approved: { label: "Approved", color: "bg-emerald-500/15 text-emerald-700" },
  pinned: { label: "Pinned", color: "bg-accent-500/15 text-accent-700" },
  superseded: { label: "Superseded", color: "bg-slate-100 text-slate-500 line-through" },
};

export function MemoryCard({ memory }: { memory: MemoryEntry }) {
  const { state, actions } = useStore();
  const type = TYPE_META[memory.type];
  const status = STATUS_META[memory.status];
  const room = state.rooms.find((r) => r.id === memory.roomId);
  const Icon = type.icon;

  const togglePin = () =>
    actions.updateMemory(memory.id, {
      status: memory.status === "pinned" ? "approved" : "pinned",
    });

  return (
    <div className="group rounded-2xl border border-slate-200 bg-slate-50 p-4 transition-all hover:border-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50", type.color)}>
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-400">{type.label}</span>
              <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", status.color)}>
                {status.label}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {memory.status === "draft" && (
            <button
              onClick={() => actions.updateMemory(memory.id, { status: "approved" })}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-700"
              title="Approve"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={togglePin}
            className={cn("rounded-lg p-1.5 hover:bg-slate-100", memory.status === "pinned" ? "text-accent-600" : "text-slate-400 hover:text-accent-600")}
            title={memory.status === "pinned" ? "Unpin" : "Pin"}
          >
            {memory.status === "pinned" ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <h4 className="mt-2.5 text-sm font-semibold leading-snug text-slate-900">{memory.title}</h4>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{memory.content}</p>

      <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2.5">
        <ActorChip id={memory.createdById} />
        <span className="text-[11px] text-slate-500">
          {room?.name} · {timeAgo(memory.createdAt)}
        </span>
      </div>
    </div>
  );
}
