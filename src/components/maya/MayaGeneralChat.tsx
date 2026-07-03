"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/demo-store";
import { MAYA_EMPLOYEE_ID, MAYA_EMPLOYEE_NAME, MAYA_EMPLOYEE_TITLE } from "@/lib/hiring/maya";
import {
  classifyMayaDmIntent,
  workspaceGuideReply,
} from "@/lib/hiring/maya-dm-intent";
import {
  mayaHiringProposalMessage,
  mayaHiringTopicCancelledReply,
  type MayaHiringProposal,
} from "@/lib/hiring/maya-hiring-proposal";
import { proposeHiringTopic } from "@/lib/hiring/hiring-session-service";
import { getRoleByKey } from "@/lib/hiring/role-library";
import {
  createClientMessageId,
  messageSendFingerprint,
  SendGuard,
} from "@/lib/messaging/idempotency";
import { AdeOrb } from "@/components/hiring/HireChrome";
import {
  MayaHiringTopicSuggestionCard,
  type TopicSuggestionAction,
} from "@/components/maya/MayaHiringTopicSuggestionCard";
import { MayaQuickActionsPanel } from "@/components/maya/MayaQuickActionsPanel";
import type { RoomTopic } from "@/lib/types";
import { cn } from "@/lib/utils";

type MayaGeneralChatProps = {
  mayaRoomId: string;
  topic: RoomTopic;
  firstName?: string;
  onCreateHiringTopic: (proposal: MayaHiringProposal) => Promise<void>;
  onContinueHiringHere: (proposal: MayaHiringProposal) => Promise<void>;
};

export function MayaGeneralChat({
  mayaRoomId,
  topic,
  firstName = "there",
  onCreateHiringTopic,
  onContinueHiringHere,
}: MayaGeneralChatProps) {
  const { state, actions } = useStore();
  const [input, setInput] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<MayaHiringProposal | null>(null);
  const [activeProposalAction, setActiveProposalAction] = useState<TopicSuggestionAction | null>(
    null,
  );
  const [awaitingRoleClarification, setAwaitingRoleClarification] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendGuardRef = useRef(new SendGuard());

  const messages = useMemo(
    () =>
      state.rooms
        .find((r) => r.id === mayaRoomId)
        ?.messages.filter((m) => m.topicId === topic.id)
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) ?? [],
    [state.rooms, mayaRoomId, topic.id],
  );

  const proposalBusy = activeProposalAction !== null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, replyBusy, pendingProposal, activeProposalAction]);

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

  const inferProposal = useCallback((text: string): MayaHiringProposal => {
    return (
      proposeHiringTopic(text) ?? {
        userText: text,
        roleTitle: getRoleByKey("custom")?.title ?? text.trim().slice(0, 48) ?? "AI Employee",
        roleKey: "custom",
      }
    );
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || replyBusy || proposalBusy) return;

      const fingerprint = messageSendFingerprint(topic.id, trimmed, "human");
      if (!sendGuardRef.current.tryBegin(fingerprint)) return;

      const clientMessageId = createClientMessageId("maya-dm");
      actions.addMessage(mayaRoomId, {
        id: clientMessageId,
        clientMessageId,
        topicId: topic.id,
        senderType: "human",
        senderId: state.user?.id ?? "user",
        senderName: state.user?.name ?? "You",
        content: trimmed,
      });

      const intent = classifyMayaDmIntent(trimmed);

      try {
        if (intent === "hiring" || (awaitingRoleClarification && trimmed.length > 2)) {
          setAwaitingRoleClarification(false);
          const proposal = inferProposal(trimmed);
          setPendingProposal(proposal);
          setReplyBusy(true);
          await new Promise((r) => setTimeout(r, 280));
          replyAsMaya(mayaHiringProposalMessage(proposal.roleTitle));
          setReplyBusy(false);
          return;
        }

        setReplyBusy(true);
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
      } finally {
        setReplyBusy(false);
        sendGuardRef.current.end();
      }
    },
    [
      actions,
      awaitingRoleClarification,
      firstName,
      inferProposal,
      mayaRoomId,
      proposalBusy,
      replyAsMaya,
      replyBusy,
      state.user,
      topic.id,
    ],
  );

  const handleProposalAction = async (action: TopicSuggestionAction) => {
    if (!pendingProposal || activeProposalAction) return;
    setActiveProposalAction(action);
    try {
      if (action === "create_topic") {
        await onCreateHiringTopic(pendingProposal);
        setPendingProposal(null);
      } else if (action === "continue_here") {
        await onContinueHiringHere(pendingProposal);
        setPendingProposal(null);
      } else {
        replyAsMaya(mayaHiringTopicCancelledReply(firstName));
        setPendingProposal(null);
      }
    } catch {
      replyAsMaya("Something went wrong — try again or choose Continue here to hire in Direct Chat.");
    } finally {
      setActiveProposalAction(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-canvas">
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
        {messages.length === 0 && !pendingProposal && (
          <p className="mx-auto max-w-md text-center text-sm leading-relaxed text-ink-2">
            Ask how AdeHQ works, get help navigating the workspace, or tell me what role you want to hire —
            I&apos;ll suggest a dedicated hiring topic when you&apos;re ready.
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
        {pendingProposal && (
          <div className="flex items-start gap-2">
            <div className="w-[26px] shrink-0" aria-hidden />
            <MayaHiringTopicSuggestionCard
              roleTitle={pendingProposal.roleTitle}
              activeAction={activeProposalAction}
              disabled={replyBusy}
              onAction={(action) => void handleProposalAction(action)}
              className="max-w-[min(100%,420px)]"
            />
          </div>
        )}
        {replyBusy && (
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
            disabled={replyBusy || proposalBusy}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-canvas px-3 py-2.5 text-sm outline-none focus:border-accent/50 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={replyBusy || proposalBusy || !input.trim()}
            className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
      </div>
      <aside className="hidden h-full min-h-0 w-[min(320px,28vw)] shrink-0 flex-col overflow-hidden border-l border-border bg-surface xl:flex">
        <MayaQuickActionsPanel
          onAction={(message) => void send(message)}
          disabled={replyBusy || proposalBusy}
        />
      </aside>
    </div>
  );
}
