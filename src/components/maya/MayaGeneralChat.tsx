"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/demo-store";
import { MAYA_EMPLOYEE_ID, MAYA_EMPLOYEE_NAME, MAYA_EMPLOYEE_TITLE } from "@/lib/hiring/maya";
import {
  classifyMayaDmIntent,
  workspaceGuideReply,
} from "@/lib/hiring/maya-dm-intent";
import { AdeOrb } from "@/components/hiring/HireChrome";
import type { RoomTopic } from "@/lib/types";
import { cn } from "@/lib/utils";

type MayaGeneralChatProps = {
  mayaRoomId: string;
  topic: RoomTopic;
  firstName?: string;
  onStartHiring: (text: string) => Promise<void>;
};

export function MayaGeneralChat({
  mayaRoomId,
  topic,
  firstName = "there",
  onStartHiring,
}: MayaGeneralChatProps) {
  const { state, actions } = useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(
    () =>
      state.rooms
        .find((r) => r.id === mayaRoomId)
        ?.messages.filter((m) => m.topicId === topic.id)
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) ?? [],
    [state.rooms, mayaRoomId, topic.id],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, busy]);

  const replyAsMaya = useCallback(
    (text: string) => {
      actions.addMessage(mayaRoomId, {
        topicId: topic.id,
        senderType: "ai",
        senderId: MAYA_EMPLOYEE_ID,
        senderName: MAYA_EMPLOYEE_NAME,
        content: text,
      });
    },
    [actions, mayaRoomId, topic.id],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      actions.addMessage(mayaRoomId, {
        topicId: topic.id,
        senderType: "human",
        senderId: state.user?.id ?? "user",
        senderName: state.user?.name ?? "You",
        content: trimmed,
      });

      const intent = classifyMayaDmIntent(trimmed);

      if (intent === "hiring") {
        setBusy(true);
        try {
          await onStartHiring(trimmed);
        } finally {
          setBusy(false);
        }
        return;
      }

      setBusy(true);
      await new Promise((r) => setTimeout(r, 350));

      if (intent === "workspace_guide" || intent === "general_chat") {
        replyAsMaya(workspaceGuideReply(trimmed, firstName));
      } else if (intent === "small_talk") {
        replyAsMaya(
          `Hey ${firstName} — I'm here when you need me. Ask how AdeHQ works, or tell me what role you'd like to hire.`,
        );
      } else {
        replyAsMaya(workspaceGuideReply(trimmed, firstName));
      }
      setBusy(false);
    },
    [actions, busy, firstName, mayaRoomId, onStartHiring, replyAsMaya, state.user, topic.id],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-surface px-5 py-3">
        <AdeOrb size={32} initials="M" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{MAYA_EMPLOYEE_NAME}</div>
          <div className="truncate text-xs text-ink-3">
            {MAYA_EMPLOYEE_TITLE} · Direct chat for everyday questions
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <p className="mx-auto max-w-md text-center text-sm leading-relaxed text-ink-2">
            Ask how AdeHQ works, get help navigating the workspace, or tell me what role you want to hire —
            I&apos;ll open a dedicated hiring topic so this chat stays clean.
          </p>
        )}
        {messages.map((m) => {
          const isUser = m.senderType === "human";
          return (
            <div key={m.id} className={cn(isUser ? "flex justify-end" : "flex items-start gap-2")}>
              {!isUser && <AdeOrb size={26} initials="M" />}
              <div
                className={cn(
                  "max-w-[84%] whitespace-pre-line px-3.5 py-2.5 text-sm leading-relaxed",
                  isUser
                    ? "rounded-[14px_14px_4px_14px] bg-ink text-white"
                    : "rounded-[4px_14px_14px_14px] border border-border bg-surface",
                )}
              >
                {m.content}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="flex items-start gap-2">
            <AdeOrb size={26} initials="M" />
            <div className="rounded-[4px_14px_14px_14px] border border-border bg-muted px-3.5 py-2.5 text-sm text-ink-2">
              <span className="inline-flex gap-1">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-surface px-5 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim()) return;
            void send(input);
            setInput("");
          }}
          className="flex gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about AdeHQ or tell me who to hire…"
            rows={2}
            disabled={busy}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-canvas px-3 py-2.5 text-sm outline-none focus:border-accent/50 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
