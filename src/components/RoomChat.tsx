"use client";

import { useEffect, useRef, useState } from "react";
import { ProjectRoom } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { useResponder } from "@/lib/ai/use-responder";
import { authHeaders } from "@/lib/api/auth-client";
import { RoomMessageItem } from "./RoomMessageItem";
import { ChatComposer } from "./ChatComposer";
import { extractMentions } from "@/lib/utils";
import { EmptyState } from "./States";
import { MessagesSquare } from "lucide-react";

export function RoomChat({ room }: { room: ProjectRoom }) {
  const { state, actions, backend } = useStore();
  const respond = useResponder();
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const roomEmployees = room.aiEmployees
    .map((id) => state.employees.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => !!e);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [room.messages.length, room.messages[room.messages.length - 1]?.pending]);

  useEffect(() => {
    actions.markRoomRead(room.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  const isDM = room.kind === "dm";
  const dmEmployee = isDM
    ? roomEmployees.find((e) => e.id === room.dmEmployeeId) ?? roomEmployees[0]
    : undefined;

  const handleSend = async (text: string) => {
    const candidates = roomEmployees.map((e) => ({ id: e.id, name: e.name }));
    const mentions = extractMentions(text, candidates);

    if (backend === "supabase") {
      setBusy(true);
      try {
        const headers = await authHeaders();
        const response = await fetch(`/api/rooms/${room.id}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            content: text,
            mode: state.settings.mode,
          }),
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "Unable to send message.");
        }
        // Realtime subscription refreshes workspace state after server persistence.
      } catch (error) {
        console.error("[AdeHQ RoomChat]", error);
      } finally {
        setBusy(false);
      }
      return;
    }

    actions.addMessage(room.id, {
      senderType: "human",
      senderId: state.user?.id ?? "user-shubham",
      senderName: state.user?.name ?? "You",
      content: text,
      mentions,
    });

    const responders = mentions.length > 0 ? mentions : isDM && dmEmployee ? [dmEmployee.id] : [];
    if (responders.length === 0) return;

    setBusy(true);
    for (const employeeId of responders) {
      await respond(room.id, employeeId, text);
    }
    setBusy(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {room.messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={MessagesSquare}
              title={isDM && dmEmployee ? `Message ${dmEmployee.name}` : "Start the conversation"}
              description={
                isDM
                  ? "Send a message and they'll reply, use tools, and create work — just like a teammate."
                  : "Mention an employee with @ to give them a task. They'll reply, use tools, and create work."
              }
            />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            {room.messages.map((m) => (
              <RoomMessageItem key={m.id} message={m} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <ChatComposer
            employees={roomEmployees}
            onSend={handleSend}
            disabled={busy}
            placeholder={isDM && dmEmployee ? `Message ${dmEmployee.name}…` : undefined}
          />
          <p className="mt-2 px-1 text-[11px] text-slate-600">
            {isDM && dmEmployee
              ? `${state.settings.mode === "live" ? "Live AI route" : "Mock AI"} · direct message with ${dmEmployee.name}`
              : `${state.settings.mode === "live" ? "Live AI route" : "Mock AI"} · ${roomEmployees.length} employees in this room`}
          </p>
        </div>
      </div>
    </div>
  );
}
