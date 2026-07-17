"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./ui";
import { useStore } from "@/lib/demo-store";
import { getDirectMessages, getGroupRooms } from "@/lib/rooms";
import { EmployeeAvatar } from "./EmployeeAvatar";
import {
  Bot,
  CheckSquare,
  Brain,
  ClipboardCheck,
  ScrollText,
  Wrench,
  Phone,
  Settings,
  Home,
  HardDrive,
  MessagesSquare,
  Search,
  UserPlus,
  Plus,
  CornerDownLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WORKFORCE_CALLS_ENABLED } from "@/lib/config/features";

type Item = {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  accent?: string;
  run: () => void;
};

export function CommandBar({
  open,
  onClose,
  onHire,
  onCreateRoom,
}: {
  open: boolean;
  onClose: () => void;
  onHire: () => void;
  onCreateRoom: () => void;
}) {
  const router = useRouter();
  const { state } = useStore();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
      onClose();
    };
    const nav: Item[] = [
      { id: "n-home", label: "Home", icon: Home, run: go("/") },
      { id: "n-drive", label: "AdeHQ Drive", icon: HardDrive, run: go("/drive") },
      { id: "n-rooms", label: "Rooms", icon: MessagesSquare, run: go("/rooms") },
      { id: "n-dm", label: "Direct messages", icon: MessagesSquare, run: go("/dm") },
      { id: "n-workforce", label: "AI Workforce", icon: Bot, run: go("/workforce") },
      { id: "n-tasks", label: "Tasks", icon: CheckSquare, run: go("/tasks") },
      { id: "n-memory", label: "Memory", icon: Brain, run: go("/memory") },
      { id: "n-approvals", label: "Approvals", icon: ClipboardCheck, run: go("/approvals") },
      { id: "n-worklog", label: "Work Log", icon: ScrollText, run: go("/work-log") },
      { id: "n-tools", label: "Tools", icon: Wrench, run: go("/tools") },
      { id: "n-calls", label: WORKFORCE_CALLS_ENABLED ? "Calls" : "Calls (soon)", icon: Phone, run: go("/calls") },
      { id: "n-settings", label: "Settings", icon: Settings, run: go("/settings") },
    ];
    const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role;
    const canHire = myRole === "admin";
    const actions: Item[] = [
      ...(canHire
        ? [
            {
              id: "a-hire",
              label: "Hire AI Employee",
              hint: "Action",
              icon: UserPlus,
              run: () => {
                onClose();
                onHire();
              },
            } satisfies Item,
          ]
        : []),
      { id: "a-room", label: "Create Project Room", hint: "Action", icon: Plus, run: () => { onClose(); onCreateRoom(); } },
    ];
    const employees: Item[] = state.employees.map((e) => ({
      id: `e-${e.id}`,
      label: e.name,
      hint: e.role,
      icon: Bot,
      accent: e.accent,
      run: () => { router.push(`/workforce/${e.id}`); onClose(); },
    }));
    const rooms: Item[] = getGroupRooms(state.rooms).map((r) => ({
      id: `r-${r.id}`,
      label: r.name,
      hint: "Room",
      icon: MessagesSquare,
      run: () => { router.push(`/rooms/${r.id}`); onClose(); },
    }));
    const dms: Item[] = getDirectMessages(state.rooms).map((r) => ({
      id: `dm-${r.id}`,
      label: r.name,
      hint: "Direct message",
      icon: MessagesSquare,
      run: () => { router.push(`/rooms/${r.id}`); onClose(); },
    }));
    return [...actions, ...nav, ...employees, ...rooms, ...dms];
  }, [
    router,
    onClose,
    onHire,
    onCreateRoom,
    state.employees,
    state.rooms,
    state.user?.id,
    state.workspaceMembers,
  ]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[active]?.run();
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" className="!bg-surface/95">
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search className="h-4 w-4 text-ink-3" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search rooms, employees, or run a command…"
          className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
        />
      </div>
      <div className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-sm text-ink-3">No results for “{query}”</div>
        ) : (
          filtered.map((item, i) => (
            <button
              key={item.id}
              onMouseEnter={() => setActive(i)}
              onClick={item.run}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                i === active ? "bg-accent-500/15 ring-1 ring-inset ring-accent-500/25" : "hover:bg-muted",
              )}
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2"
                style={item.accent ? { background: `${item.accent}22`, color: item.accent } : { background: "var(--muted)" }}
              >
                <item.icon className="h-4 w-4" />
              </span>
              <span className="flex-1 text-sm font-medium text-ink">{item.label}</span>
              {item.hint && <span className="text-xs text-ink-3">{item.hint}</span>}
              {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-ink-3" />}
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
