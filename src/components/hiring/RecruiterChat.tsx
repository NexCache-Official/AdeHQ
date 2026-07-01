"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  MAYA_EMPLOYEE_NAME,
  MAYA_EMPLOYEE_TITLE,
  MAYA_RECRUITER_TAGLINE,
} from "@/lib/hiring/maya";
import type { MayaRecruiterState } from "@/lib/hiring/maya-recruiter-state";
import type { RecruiterReadiness, RecruiterSuggestionChip } from "@/lib/hiring/types";
import { AdeOrb } from "@/components/hiring/HireChrome";
import { TypewriterText } from "@/components/hiring/BriefSections";

export function RecruiterChat({
  messages,
  chips,
  readiness,
  briefReady,
  busy,
  mayaState = "idle",
  onSend,
  onReview,
  variant = "recruiter",
  placeholder = "What job do you need done?",
  emptyState,
}: {
  messages: { role: "ade" | "user"; text: string; isOptimistic?: boolean }[];
  chips: RecruiterSuggestionChip[];
  readiness: RecruiterReadiness;
  briefReady: boolean;
  busy: boolean;
  mayaState?: MayaRecruiterState;
  onSend: (text: string, action?: "message" | "draft_now" | "refine_section") => void;
  onReview: () => void;
  variant?: "recruiter" | "refinement";
  placeholder?: string;
  emptyState?: React.ReactNode;
}) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const allChips =
    briefReady && variant === "recruiter" && !chips.some((chip) => chip.intent === "review_brief")
      ? [
          {
            id: "review-brief",
            label: "Show me the job brief",
            value: "Review job brief",
            intent: "review_brief" as const,
          },
          ...chips,
        ]
      : chips;

  const readinessLabel =
    readiness.ready ? "Ready to review" : readiness.score >= 50 ? "Almost ready" : "Understanding role…";

  const handleChip = (chip: RecruiterSuggestionChip) => {
    if (chip.intent === "review_brief") {
      onReview();
      return;
    }
    onSend(
      chip.value,
      chip.intent === "draft_brief_now" ? "draft_now" : "message",
    );
  };

  const thinkingLabel =
    mayaState === "acknowledging"
      ? `${MAYA_EMPLOYEE_NAME} is reviewing the role…`
      : mayaState === "updating_brief"
        ? `${MAYA_EMPLOYEE_NAME} is updating the brief…`
        : mayaState === "thinking"
          ? `${MAYA_EMPLOYEE_NAME} is thinking…`
          : `${MAYA_EMPLOYEE_NAME} is preparing candidates…`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-surface px-5 py-3">
        <AdeOrb size={32} initials="M" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{MAYA_EMPLOYEE_NAME}</div>
          <div className="truncate text-xs text-ink-3">
            {variant === "refinement"
              ? "Refine the job brief in real time"
              : `${MAYA_EMPLOYEE_TITLE} · ${MAYA_RECRUITER_TAGLINE}`}
          </div>
        </div>
        {messages.length > 0 && (
          <div className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] text-ink-2">
            {readinessLabel} · {readiness.score}%
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 && emptyState}
        {messages.map((m, i) => (
          <RecruiterMessageRow
            key={`${i}-${m.text.slice(0, 24)}`}
            message={m}
            index={i}
            typeOut={m.role === "ade" && i === messages.length - 1 && !m.isOptimistic}
          />
        ))}
        {busy && !messages.some((m) => m.isOptimistic) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2"
          >
            <AdeOrb size={26} initials="M" />
            <div className="rounded-[4px_14px_14px_14px] border border-border bg-muted px-3.5 py-2.5 text-sm text-ink-2">
              {thinkingLabel}
            </div>
          </motion.div>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-border bg-surface px-5 py-4">
        {allChips.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {allChips.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleChip(c)}
                disabled={busy}
                className={cn(
                  "rounded-full border px-3.5 py-2 text-[13px] disabled:opacity-50",
                  c.intent === "review_brief"
                    ? "border-ink bg-ink text-white hover:bg-ink/90"
                    : "border-border bg-muted/50 hover:border-ink hover:bg-ink hover:text-white",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim()) return;
            onSend(input);
            setInput("");
          }}
          className="flex gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
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

function RecruiterMessageRow({
  message,
  index,
  typeOut = false,
}: {
  message: { role: "ade" | "user"; text: string; isOptimistic?: boolean };
  index: number;
  typeOut?: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, x: isUser ? 28 : -20, y: 10 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{
        duration: 0.32,
        delay: Math.min(index * 0.04, 0.2),
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn(
        isUser ? "flex justify-end" : "flex items-start gap-2",
        message.isOptimistic && "opacity-95",
      )}
    >
      {!isUser && <AdeOrb size={26} initials="M" />}
      <div
        className={cn(
          "max-w-[84%] px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "rounded-[14px_14px_4px_14px] bg-ink text-white"
            : "rounded-[4px_14px_14px_14px] border border-border bg-surface",
          message.isOptimistic && !isUser && "border-accent/30 bg-accent-soft/25 italic",
        )}
      >
        {typeOut ? (
          <TypewriterText text={message.text} active speed={10} />
        ) : (
          message.text
        )}
      </div>
    </motion.div>
  );
}
