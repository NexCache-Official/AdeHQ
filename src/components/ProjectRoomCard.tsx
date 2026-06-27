"use client";

import Link from "next/link";
import { ProjectRoom } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { Card } from "./ui";
import { timeAgo } from "@/lib/utils";
import { CheckSquare, MessagesSquare, Users } from "lucide-react";

export function ProjectRoomCard({ room }: { room: ProjectRoom }) {
  const { state } = useStore();
  const employees = room.aiEmployees
    .map((id) => state.employees.find((e) => e.id === id))
    .filter(Boolean);
  const activeTasks = state.tasks.filter(
    (t) => t.roomId === room.id && t.status !== "done",
  ).length;

  return (
    <Link href={`/rooms/${room.id}`}>
      <Card hover className="group relative h-full overflow-hidden p-5">
        <div
          className="absolute inset-x-0 top-0 h-1 opacity-80"
          style={{ background: `linear-gradient(90deg, ${room.accent}, transparent)` }}
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-slate-900 group-hover:text-accent-700">
              {room.name}
            </h3>
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{room.description}</p>
          </div>
          {room.unread > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[11px] font-semibold text-white">
              {room.unread}
            </span>
          )}
        </div>

        <div className="mt-4 flex items-center gap-1.5">
          <div className="flex -space-x-2">
            {room.humans.map((h) => (
              <HumanAvatar key={h} name={state.user?.name ?? "You"} size="sm" className="!h-8 !w-8 ring-2 ring-white" />
            ))}
            {employees.slice(0, 4).map(
              (e) =>
                e && (
                  <div key={e.id} className="ring-2 ring-white rounded-2xl">
                    <EmployeeAvatar employee={e} size="sm" showStatus={false} className="!h-8 !w-8" />
                  </div>
                ),
            )}
          </div>
          {employees.length > 4 && (
            <span className="text-xs text-slate-500">+{employees.length - 4}</span>
          )}
        </div>

        <div className="mt-4 flex items-center gap-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> {room.humans.length + employees.length}
          </span>
          <span className="flex items-center gap-1.5">
            <MessagesSquare className="h-3.5 w-3.5" /> {room.messages.length}
          </span>
          <span className="flex items-center gap-1.5">
            <CheckSquare className="h-3.5 w-3.5" /> {activeTasks} active
          </span>
          <span className="ml-auto">{timeAgo(room.updatedAt)}</span>
        </div>
      </Card>
    </Link>
  );
}
