"use client";

import Link from "next/link";
import { useStore } from "@/lib/demo-store";
import { useShellUI } from "@/components/AppShell";
import { PageContainer } from "@/components/Page";
import { ChannelIcon } from "@/components/EmployeeAvatar";
import { avatarGradient, initials } from "@/lib/utils";
import { getGroupChannels } from "@/lib/rooms";
import { Plus } from "lucide-react";

export default function RoomsPage() {
  const { state } = useStore();
  const ui = useShellUI();
  const channels = getGroupChannels(state.rooms);

  return (
    <PageContainer wide>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Channels</h1>
          <p className="mt-1 text-sm text-ink-2">
            Group spaces where you and your AI employees collaborate on projects.
          </p>
        </div>
        <button
          type="button"
          onClick={ui.openCreateRoom}
          className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-muted"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Create channel
        </button>
      </div>

      {channels.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center text-sm text-ink-3">
          No channels yet. Create one to start collaborating with your AI team.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((room) => {
            const employees = room.aiEmployees
              .map((id) => state.employees.find((e) => e.id === id))
              .filter(Boolean);
            const latest =
              room.messages[room.messages.length - 1]?.content?.slice(0, 48) ?? "No messages yet";
            return (
              <Link
                key={room.id}
                href={`/rooms/${room.id}`}
                className="lift block rounded-2xl border border-border bg-surface p-[14px_15px]"
              >
                <div className="flex items-center gap-2.5">
                  <ChannelIcon className="!h-[34px] !w-[34px] !rounded-[10px]" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[13.5px] text-ink">{room.name}</div>
                    <div className="truncate text-[11.5px] text-ink-3">{latest}</div>
                  </div>
                  {room.unread > 0 && (
                    <span className="shrink-0 rounded-full bg-accent px-[7px] py-px font-mono text-[10.5px] font-semibold text-white">
                      {room.unread}
                    </span>
                  )}
                </div>
                <div className="mt-[11px] flex items-center justify-between">
                  <div className="flex -space-x-1.5">
                    {employees.slice(0, 3).map(
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
                    {room.humans.length + employees.length} members
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
