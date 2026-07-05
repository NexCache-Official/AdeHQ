"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  MAYA_EMPLOYEE_NAME,
  MAYA_EMPLOYEE_TITLE,
  MAYA_RECRUITER_TAGLINE,
} from "@/lib/hiring/maya";
import { isProceedToBriefAction } from "@/lib/hiring/recruiter-intents";
import type { MayaRecruiterState } from "@/lib/hiring/maya-recruiter-state";
import type {
  AiEmployeeApplicant,
  RecruiterReadiness,
  RecruiterSuggestionChip,
} from "@/lib/hiring/types";
import { AdeOrb } from "@/components/hiring/HireChrome";
import { TypewriterText } from "@/components/hiring/BriefSections";
import { Sparkles, FileText } from "lucide-react";

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
  candidates = [],
  onGenerateCandidates,
  onInterviewCandidate,
  onHireCandidate,
  generatingCandidates = false,
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
  candidates?: AiEmployeeApplicant[];
  onGenerateCandidates?: () => void;
  onInterviewCandidate?: (candidate: AiEmployeeApplicant) => void;
  onHireCandidate?: (candidate: AiEmployeeApplicant) => void;
  generatingCandidates?: boolean;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  const handleMessagesScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 96;
  };

  const allChips = chips.filter((chip) => chip.intent !== "review_brief");

  const readinessLabel =
    readiness.ready ? "Ready to review" : readiness.score >= 50 ? "Almost ready" : "Understanding role…";

  const handleChip = (chip: RecruiterSuggestionChip) => {
    if (
      chip.intent === "review_brief" ||
      isProceedToBriefAction(chip.value) ||
      isProceedToBriefAction(chip.label)
    ) {
      onReview();
      return;
    }
    if (chip.intent === "generate_candidates" && onGenerateCandidates) {
      onGenerateCandidates();
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
        {briefReady && variant === "recruiter" && (
          <button
            type="button"
            onClick={onReview}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-green/90 disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" />
            Review job brief
          </button>
        )}
        {briefReady && onGenerateCandidates && candidates.length === 0 && (
          <button
            type="button"
            onClick={onGenerateCandidates}
            disabled={busy || generatingCandidates}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {generatingCandidates ? (
              "Generating…"
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Generate 3 candidates
              </>
            )}
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleMessagesScroll}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 py-4"
      >
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
              <span className="inline-flex items-center gap-2">
                {thinkingLabel}
                <span className="inline-flex gap-0.5">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </span>
              </span>
            </div>
          </motion.div>
        )}
        {candidates.length > 0 && (
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            {candidates.map((candidate) => (
              <div
                key={candidate.id}
                className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm"
              >
                <div className="mb-2 flex items-center gap-2">
                  <AdeOrb size={36} initials={candidate.first} grad={candidate.grad} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{candidate.name}</div>
                    <div className="truncate text-[11px] text-ink-3">{candidate.title}</div>
                  </div>
                </div>
                {candidate.recommended && (
                  <span className="mb-2 w-fit rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-700">
                    Recommended
                  </span>
                )}
                <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-ink-2">
                  {candidate.strengths[0] ?? candidate.engineLabel}
                </p>
                <div className="mt-auto flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => onInterviewCandidate?.(candidate)}
                    disabled={busy}
                    className="rounded-lg border border-border py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
                  >
                    Interview
                  </button>
                  <button
                    type="button"
                    onClick={() => onHireCandidate?.(candidate)}
                    disabled={busy}
                    className="rounded-lg bg-ink py-2 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Hire {candidate.first}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
                    ? "border-green bg-green text-white hover:bg-green/90"
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
            stickToBottomRef.current = true;
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
        {typeOut && !hasChatMarkdown(message.text) ? (
          <TypewriterText text={message.text} active speed={3} />
        ) : (
          <ChatMarkdown text={message.text} />
        )}
      </div>
    </motion.div>
  );
}

function hasChatMarkdown(text: string): boolean {
  return /\*\*[^*]+\*\*|(?:^|\s)-\s+\S/.test(text);
}

function ChatMarkdown({ text }: { text: string }) {
  const normalized = text.replace(/\s+-\s+(?=\*\*|[A-Z0-9])/g, "\n- ");
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const blocks: Array<{ type: "p"; text: string } | { type: "ul"; items: string[] }> = [];

  for (const line of lines) {
    if (line.startsWith("- ")) {
      const last = blocks[blocks.length - 1];
      if (last?.type === "ul") {
        last.items.push(line.slice(2).trim());
      } else {
        blocks.push({ type: "ul", items: [line.slice(2).trim()] });
      }
    } else {
      blocks.push({ type: "p", text: line });
    }
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, index) =>
        block.type === "ul" ? (
          <ul key={index} className="space-y-1 pl-1">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="flex gap-2">
                <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-current opacity-45" />
                <span>{renderInlineMarkdown(item)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>{renderInlineMarkdown(block.text)}</p>
        ),
      )}
    </div>
  );
}

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}
