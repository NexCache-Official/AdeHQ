"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectRoom } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { useResponder } from "@/lib/ai/use-responder";
import { authHeaders } from "@/lib/api/auth-client";
import { RoomMessageItem } from "./RoomMessageItem";
import { ChatComposer } from "./ChatComposer";
import { EmptyState } from "./States";
import { Button } from "./ui";
import { extractMentions, uid } from "@/lib/utils";
import {
  AlertCircle,
  Bot,
  ListChecks,
  MessagesSquare,
  RotateCcw,
  UserPlus,
} from "lucide-react";

type PendingSend = {
  clientMessageId: string;
  content: string;
};

export function RoomChat({ room }: { room: ProjectRoom }) {
  const { state, actions, backend } = useStore();
  const respond = useResponder();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failedSend, setFailedSend] = useState<PendingSend | null>(null);
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

  const useServerApi = backend === "supabase";

  const sendViaServer = async (text: string, clientMessageId?: string) => {
    setBusy(true);
    setFailedSend(null);
    const messageId = clientMessageId ?? uid("msg");
    const mentions = extractMentions(
      text,
      roomEmployees.map((e) => ({ id: e.id, name: e.name })),
    );

    actions.addLocalMessage(room.id, {
      id: messageId,
      senderType: "human",
      senderId: state.user?.id ?? "unknown",
      senderName: state.user?.name ?? "You",
      content: text,
      mentions,
    });

    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/rooms/${room.id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: text,
          clientMessageId: messageId,
          mode: state.settings.mode,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Unable to send message.");
      }
      actions.updateMessage(room.id, messageId, { pending: false });
    } catch (error) {
      actions.removeLocalMessage(room.id, messageId);
      setFailedSend({ clientMessageId: messageId, content: text });
      console.error("[AdeHQ RoomChat]", error);
    } finally {
      setBusy(false);
    }
  };

  const sendViaDemo = async (text: string) => {
    const candidates = roomEmployees.map((e) => ({ id: e.id, name: e.name }));
    const mentions = extractMentions(text, candidates);

    actions.addMessage(room.id, {
      senderType: "human",
      senderId: state.user?.id ?? "demo-user",
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

  const handleSend = async (text: string) => {
    if (useServerApi) {
      await sendViaServer(text);
      return;
    }
    if (ENABLE_DEMO_MODE) {
      await sendViaDemo(text);
    }
  };

  const retryFailed = async () => {
    if (!failedSend) return;
    const { clientMessageId, content } = failedSend;
    actions.removeLocalMessage(room.id, clientMessageId);
    setFailedSend(null);
    await sendViaServer(content);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {room.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <EmptyState
              icon={MessagesSquare}
              title={isDM && dmEmployee ? `Message ${dmEmployee.name}` : "Start the conversation"}
              description={
                isDM
                  ? "Send a message and they'll reply when mentioned or in this DM."
                  : "Send a message to your team. Mention an AI employee with @ when you want help."
              }
            />
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => router.push("/settings")}>
                <UserPlus className="h-4 w-4" /> Invite humans
              </Button>
              <Button variant="secondary" size="sm" onClick={() => router.push("/workforce")}>
                <Bot className="h-4 w-4" /> Add AI employee
              </Button>
              <Button variant="secondary" size="sm" onClick={() => router.push("/tasks")}>
                <ListChecks className="h-4 w-4" /> Create first task
              </Button>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            {room.messages.map((m) => (
              <RoomMessageItem key={m.id} message={m} />
            ))}
            {busy && (
              <div className="px-1 py-2 text-xs text-slate-500">Sending…</div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {failedSend && (
        <div className="border-t border-rose-200 bg-rose-50 px-4 py-2 sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center gap-3 text-sm text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">Message failed to send.</span>
            <Button size="sm" variant="secondary" onClick={retryFailed}>
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        </div>
      )}

      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <ChatComposer
            employees={roomEmployees}
            onSend={handleSend}
            disabled={busy}
            placeholder={isDM && dmEmployee ? `Message ${dmEmployee.name}…` : undefined}
          />
          {useServerApi && roomEmployees.length > 0 && (
            <p className="mt-2 px-1 text-[11px] text-slate-600">
              {roomEmployees.length} AI employee{roomEmployees.length === 1 ? "" : "s"} in this room · mention with @ for a reply
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
