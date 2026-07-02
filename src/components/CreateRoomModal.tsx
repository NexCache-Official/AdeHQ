"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, ModalHeader } from "./ui";
import { useStore } from "@/lib/demo-store";
import { roomAssignableEmployees } from "@/lib/maya-employee";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { cn } from "@/lib/utils";
import { Check, Hash } from "lucide-react";

const ACCENTS = ["#2f6fed", "#5b8cff", "#22d3ee", "#34d399", "#f472b6", "#fbbf24"];

export function CreateRoomModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { state, actions } = useStore();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brief, setBrief] = useState("");
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [selected, setSelected] = useState<string[]>([]);
  const assignableEmployees = roomAssignableEmployees(state.employees);

  const reset = () => {
    setName("");
    setDescription("");
    setBrief("");
    setAccent(ACCENTS[0]);
    setSelected([]);
  };

  const close = () => {
    onClose();
    setTimeout(reset, 250);
  };

  const toggle = (id: string) =>
    setSelected((p) => (p.includes(id) ? p.filter((e) => e !== id) : [...p, id]));

  const create = () => {
    if (!name.trim()) return;
    const room = actions.createRoom({
      name: name.trim(),
      description,
      brief,
      accent,
      aiEmployees: selected,
    });
    close();
    router.push(`/rooms/${room.id}`);
  };

  return (
    <Modal open={open} onClose={close} size="lg">
      <ModalHeader
        title="Create a room"
        subtitle="A group space where you and your AI employees work together."
        onClose={close}
        icon={<Hash className="h-5 w-5" />}
      />
      <div className="max-h-[min(62vh,560px)] space-y-4 overflow-y-auto px-6 py-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Room name</span>
          <input
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Engineering, DevOps, Launch Room"
            autoFocus
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Short description</span>
          <input
            className="input-field"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this room for?"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Project brief</span>
          <textarea
            className="input-field min-h-[80px] resize-none"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Give your AI employees context: goals, constraints, what to avoid…"
          />
        </label>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Accent</span>
          <div className="flex gap-2">
            {ACCENTS.map((c) => (
              <button
                key={c}
                onClick={() => setAccent(c)}
                className={cn(
                  "h-7 w-7 rounded-lg ring-2 ring-offset-2 ring-offset-white transition-all",
                  accent === c ? "ring-white/60" : "ring-transparent",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-medium text-slate-500">
            Add AI employees ({selected.length})
          </span>
          <div className="grid gap-2 sm:grid-cols-2">
            {assignableEmployees.length === 0 ? (
              <p className="sm:col-span-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                Hire an AI employee first, then add them to this room.
              </p>
            ) : (
              assignableEmployees.map((e) => {
              const on = selected.includes(e.id);
              return (
                <button
                  key={e.id}
                  onClick={() => toggle(e.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors",
                    on ? "border-accent-500/40 bg-accent-500/[0.06]" : "border-slate-200 bg-slate-50 hover:bg-slate-50",
                  )}
                >
                  <EmployeeAvatar employee={e} size="sm" showStatus={false} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{e.name}</div>
                    <div className="truncate text-[11px] text-slate-500">{e.role}</div>
                  </div>
                  {on && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-500 text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button onClick={create} disabled={!name.trim()}>Create room</Button>
      </div>
    </Modal>
  );
}
