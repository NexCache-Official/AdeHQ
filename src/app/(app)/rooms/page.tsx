"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/demo-store";
import { useShellUI } from "@/components/AppShell";
import { PageContainer } from "@/components/Page";
import { RoomIcon } from "@/components/EmployeeAvatar";
import { avatarGradient, initials } from "@/lib/utils";
import { getArchivedGroupRooms, getGroupRooms } from "@/lib/rooms";
import { authHeaders } from "@/lib/api/auth-client";
import type { ProjectRoom } from "@/lib/types";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui";

export default function RoomsPage() {
  const { state, actions, backend } = useStore();
  const ui = useShellUI();
  const router = useRouter();
  const rooms = getGroupRooms(state.rooms);
  const archivedRooms = getArchivedGroupRooms(state.rooms);
  const [archivedOpen, setArchivedOpen] = useState(archivedRooms.length > 0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  const runRoomAction = async (
    room: ProjectRoom,
    action: "archive" | "restore" | "delete",
  ) => {
    setError(null);
    setBusyId(room.id);
    setMenuId(null);
    try {
      if (backend === "supabase") {
        const headers = await authHeaders();
        if (action === "restore") {
          const res = await fetch(`/api/rooms/${room.id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ status: "active" }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => null);
            throw new Error(err?.error ?? "Failed to restore room");
          }
          const { room: updated } = await res.json();
          actions.updateRoom(room.id, updated);
        } else if (action === "archive") {
          const res = await fetch(`/api/rooms/${room.id}`, { method: "DELETE", headers });
          if (!res.ok) {
            const err = await res.json().catch(() => null);
            throw new Error(err?.error ?? "Failed to archive room");
          }
          const { room: updated } = await res.json();
          actions.updateRoom(room.id, updated);
        } else {
          const res = await fetch(`/api/rooms/${room.id}?permanent=true`, {
            method: "DELETE",
            headers,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => null);
            throw new Error(err?.error ?? "Failed to delete room");
          }
          actions.removeRoomPermanently(room.id);
        }
      } else {
        if (action === "restore") {
          actions.updateRoom(room.id, { status: "active" });
        } else if (action === "archive") {
          actions.updateRoom(room.id, { status: "archived" });
        } else {
          actions.removeRoomPermanently(room.id);
        }
      }
      setConfirmDeleteId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Room action failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageContainer wide>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Rooms</h1>
          <p className="mt-1 text-sm text-ink-2">
            Group spaces where you and your AI employees collaborate. Each room has topics inside it.
          </p>
        </div>
        <button
          type="button"
          onClick={ui.openCreateRoom}
          className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-muted"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Create room
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {rooms.length === 0 && archivedRooms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center text-sm text-ink-3">
          No rooms yet. Create one to start collaborating with your AI team.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              employees={state.employees}
              busy={busyId === room.id}
              menuOpen={menuId === room.id}
              confirmDelete={confirmDeleteId === room.id}
              onOpen={() => router.push(`/rooms/${room.id}`)}
              onToggleMenu={() => setMenuId((id) => (id === room.id ? null : room.id))}
              onArchive={() => void runRoomAction(room, "archive")}
              onDeleteRequest={() => {
                setMenuId(null);
                setConfirmDeleteId(room.id);
              }}
              onDeleteConfirm={() => void runRoomAction(room, "delete")}
              onDeleteCancel={() => setConfirmDeleteId(null)}
            />
          ))}
        </div>
      )}

      {archivedRooms.length > 0 && (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setArchivedOpen((v) => !v)}
            className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3"
          >
            {archivedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Archived ({archivedRooms.length})
          </button>
          {archivedOpen && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {archivedRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  employees={state.employees}
                  archived
                  busy={busyId === room.id}
                  menuOpen={menuId === room.id}
                  confirmDelete={confirmDeleteId === room.id}
                  onOpen={() => router.push(`/rooms/${room.id}`)}
                  onToggleMenu={() => setMenuId((id) => (id === room.id ? null : room.id))}
                  onRestore={() => void runRoomAction(room, "restore")}
                  onDeleteRequest={() => {
                    setMenuId(null);
                    setConfirmDeleteId(room.id);
                  }}
                  onDeleteConfirm={() => void runRoomAction(room, "delete")}
                  onDeleteCancel={() => setConfirmDeleteId(null)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </PageContainer>
  );
}

function RoomCard({
  room,
  employees,
  archived = false,
  busy,
  menuOpen,
  confirmDelete,
  onOpen,
  onToggleMenu,
  onArchive,
  onRestore,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  room: ProjectRoom;
  employees: { id: string; name: string; accent: string }[];
  archived?: boolean;
  busy?: boolean;
  menuOpen?: boolean;
  confirmDelete?: boolean;
  onOpen: () => void;
  onToggleMenu: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  const roomEmployees = room.aiEmployees
    .map((id) => employees.find((e) => e.id === id))
    .filter(Boolean);
  const latest =
    room.messages[room.messages.length - 1]?.content?.slice(0, 48) ?? "No messages yet";

  return (
    <div
      className={`relative rounded-2xl border bg-surface p-[14px_15px] ${
        archived ? "border-border/70 opacity-90" : "border-border lift"
      }`}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-center gap-2.5">
          <RoomIcon className="!h-[34px] !w-[34px] !rounded-[10px]" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[13.5px] text-ink">{room.name}</div>
            <div className="truncate text-[11.5px] text-ink-3">{latest}</div>
          </div>
          {room.unread > 0 && !archived && (
            <span className="shrink-0 rounded-full bg-accent px-[7px] py-px font-mono text-[10.5px] font-semibold text-white">
              {room.unread}
            </span>
          )}
        </div>
        <div className="mt-[11px] flex items-center justify-between">
          <div className="flex -space-x-1.5">
            {roomEmployees.slice(0, 3).map(
              (e) =>
                e && (
                  <span
                    key={e.id}
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border-2 border-surface text-[9px] font-bold text-white"
                    style={{ backgroundImage: avatarGradient(e.accent) }}
                  >
                    {initials(e.name)}
                  </span>
                ),
            )}
          </div>
          <span className="text-[11px] text-ink-3">
            {room.humans.length + roomEmployees.length} members
          </span>
        </div>
      </button>

      <div className="absolute right-2 top-2">
        <button
          type="button"
          onClick={onToggleMenu}
          disabled={busy}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
          aria-label="Room options"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-10 mt-1 w-44 rounded-xl border border-border bg-surface py-1 shadow-lg">
            <Link
              href={`/rooms/${room.id}`}
              className="block px-3 py-2 text-xs text-ink-2 hover:bg-muted"
            >
              Open room
            </Link>
            {archived ? (
              onRestore && (
                <button
                  type="button"
                  onClick={onRestore}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink-2 hover:bg-muted"
                >
                  <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                </button>
              )
            ) : (
              onArchive && (
                <button
                  type="button"
                  onClick={onArchive}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink-2 hover:bg-muted"
                >
                  <Archive className="h-3.5 w-3.5" /> Archive
                </button>
              )
            )}
            <button
              type="button"
              onClick={onDeleteRequest}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete permanently
            </button>
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs text-red-900">
            Permanently delete <strong>{room.name}</strong>? This removes all topics, messages,
            memory, and history in this room.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="danger" onClick={onDeleteConfirm} disabled={busy}>
              Delete forever
            </Button>
            <Button size="sm" variant="ghost" onClick={onDeleteCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
