"use client";

import { useEffect, useRef, useState } from "react";
import { AIEmployee, MentionRef } from "@/lib/types";
import { EmployeeAvatar } from "./EmployeeAvatar";
import {
  AtSign,
  Plus,
  SendHorizontal,
  Slash,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const QUICK_COMMANDS = [
  { label: "Summarize room", text: "/summary" },
  { label: "Create tasks from discussion", text: "@PM Employee turn our discussion into concrete tasks." },
  { label: "Save decision", text: "/memory Our latest decision for this topic." },
  { label: "Request approval", text: "@PM Employee request approval for the current plan." },
];

const SLASH_COMMANDS = [
  { cmd: "/help", label: "Show available commands", example: "/help" },
  { cmd: "/task", label: "Create a task", example: "/task Build landing page" },
  { cmd: "/memory", label: "Save to topic memory", example: "/memory Key decision here" },
  { cmd: "/summary", label: "Summarize this topic", example: "/summary" },
  { cmd: "/ask", label: "Draft an AI question", example: "/ask" },
  { cmd: "/archive", label: "Archive current topic", example: "/archive" },
  { cmd: "/assign", label: "Add employee to topic", example: "/assign @Research Employee" },
];

export type SlashCommandResult =
  | { type: "help" }
  | { type: "task"; title: string }
  | { type: "memory"; content: string }
  | { type: "summary" }
  | { type: "ask" }
  | { type: "archive" }
  | { type: "assign"; employeeId: string; employeeName: string }
  | { type: "send"; text: string };

function parseSlashCommand(text: string, employees: AIEmployee[]): SlashCommandResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [command, ...rest] = trimmed.split(/\s+/);
  const args = rest.join(" ").trim();
  const lower = command.toLowerCase();

  if (lower === "/help") return { type: "help" };

  if (lower === "/task") {
    if (!args) return null;
    return { type: "task", title: args };
  }

  if (lower === "/memory") {
    if (!args) return null;
    return { type: "memory", content: args };
  }

  if (lower === "/summary") return { type: "summary" };

  if (lower === "/ask") return { type: "ask" };

  if (lower === "/archive") return { type: "archive" };

  if (lower === "/assign") {
    const mentionMatch = args.match(/@(.+)/);
    const name = mentionMatch?.[1]?.trim() ?? args.trim();
    const emp = employees.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (!emp) return null;
    return { type: "assign", employeeId: emp.id, employeeName: emp.name };
  }

  return null;
}

export function ChatComposer({
  employees,
  onSend,
  disabled,
  placeholder,
  draftText,
  onDraftConsumed,
  onSlashCommand,
}: {
  employees: AIEmployee[];
  onSend: (text: string, mentionsJson?: MentionRef[]) => void;
  disabled?: boolean;
  placeholder?: string;
  draftText?: string;
  onDraftConsumed?: () => void;
  onSlashCommand?: (result: SlashCommandResult) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [trackedMentions, setTrackedMentions] = useState<MentionRef[]>([]);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!draftText) return;
    setValue(draftText);
    setMentionQuery(null);
    setSlashQuery(null);
    inputRef.current?.focus();
    onDraftConsumed?.();
  }, [draftText, onDraftConsumed]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    const caret = e.target.selectionStart;
    const before = v.slice(0, caret);
    const mentionMatch = before.match(/@(\w*)$/);
    const slashMatch = before.match(/(?:^|\s)(\/[\w-]*)$/);
    setMentionQuery(mentionMatch ? mentionMatch[1] : null);
    setSlashQuery(slashMatch ? slashMatch[1] : null);
    if (slashMatch) setShowCommands(false);
  };

  const insertMention = (emp: AIEmployee) => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const match = before.match(/@([\w\s-]*)$/);
    const start = match ? before.length - match[0].length : before.length;
    const next = `${value.slice(0, start)}@${emp.name} ${after}`;
    const nextCaret = start + emp.name.length + 2;

    setValue(next);
    setTrackedMentions((prev) => {
      if (prev.some((m) => m.id === emp.id)) return prev;
      return [...prev, { type: "ai_employee", id: emp.id, label: emp.name }];
    });
    setMentionQuery(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const insertSlash = (example: string) => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const match = before.match(/(?:^|\s)(\/[\w-]*)$/);
    const start = match ? before.length - match[0].length : before.length;
    const prefix = match ? before.slice(0, start) : before;
    const next = `${prefix}${example} ${after}`;
    setValue(next);
    setSlashQuery(null);
    setShowCommands(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const send = async () => {
    const text = value.trim();
    if (!text || disabled) return;

    const slash = parseSlashCommand(text, employees);
    if (slash && onSlashCommand) {
      if (slash.type !== "help") {
        setValue("");
        setMentionQuery(null);
        setSlashQuery(null);
        setTrackedMentions([]);
        await onSlashCommand(slash);
        return;
      }
      setCommandNotice("Commands: /help /task /memory /summary /ask /archive /assign");
      setShowCommands(true);
      return;
    }

    onSend(text, trackedMentions.length ? trackedMentions : undefined);
    setValue("");
    setMentionQuery(null);
    setSlashQuery(null);
    setTrackedMentions([]);
    setCommandNotice(null);
  };

  const filteredMentions = employees.filter((e) =>
    mentionQuery === "" ? true : e.name.toLowerCase().includes((mentionQuery ?? "").toLowerCase()),
  );

  const filteredSlash =
    slashQuery === null
      ? []
      : SLASH_COMMANDS.filter((c) =>
          slashQuery === "/" ? true : c.cmd.toLowerCase().startsWith(slashQuery.toLowerCase()),
        );

  return (
    <div className="relative">
      <AnimatePresence>
        {slashQuery !== null && filteredSlash.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 mb-2 w-80 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              Slash commands
            </div>
            {filteredSlash.map((c) => (
              <button
                type="button"
                key={c.cmd}
                onClick={() => insertSlash(c.example)}
                className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
              >
                <span className="text-sm font-medium text-ink">{c.cmd}</span>
                <span className="text-[11px] text-ink-3">{c.label}</span>
              </button>
            ))}
          </motion.div>
        )}

        {mentionQuery !== null && filteredMentions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              Mention an employee
            </div>
            {filteredMentions.map((e) => (
              <button
                type="button"
                key={e.id}
                onClick={() => insertMention(e)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
              >
                <EmployeeAvatar employee={e} size="xs" showStatus={false} />
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink">{e.name}</div>
                  <div className="truncate text-[11px] text-ink-3">{e.role}</div>
                </div>
              </button>
            ))}
          </motion.div>
        )}

        {showCommands && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 mb-2 w-80 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              Quick commands
            </div>
            {commandNotice && (
              <p className="px-2 py-1 text-[11px] text-accent-d">{commandNotice}</p>
            )}
            {employees.slice(0, 3).map((e) => (
              <button
                type="button"
                key={e.id}
                onClick={() => {
                  setValue(`@${e.name} `);
                  setTrackedMentions((prev) => {
                    if (prev.some((m) => m.id === e.id)) return prev;
                    return [...prev, { type: "ai_employee", id: e.id, label: e.name }];
                  });
                  setShowCommands(false);
                  inputRef.current?.focus();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-muted"
              >
                <Sparkles className="h-3.5 w-3.5 text-accent" /> Ask {e.name}
              </button>
            ))}
            {QUICK_COMMANDS.map((c) => (
              <button
                type="button"
                key={c.label}
                onClick={() => {
                  setValue(c.text);
                  setShowCommands(false);
                  inputRef.current?.focus();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-muted"
              >
                <Slash className="h-3.5 w-3.5 text-ink-3" /> {c.label}
              </button>
            ))}
            <div className="border-t border-border-2 px-2 py-1.5">
              <div className="text-[10px] font-medium text-ink-3">All slash commands</div>
              {SLASH_COMMANDS.map((c) => (
                <button
                  type="button"
                  key={c.cmd}
                  onClick={() => insertSlash(c.example)}
                  className="block w-full py-0.5 text-left text-[11px] text-ink-2 hover:text-accent-d"
                >
                  {c.cmd} — {c.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showCommands && (
        <div className="fixed inset-0 z-0" onClick={() => setShowCommands(false)} />
      )}

      <div className="relative z-10 rounded-[17px] border border-border bg-surface p-1.5 shadow-[0_8px_26px_-18px_rgba(40,30,15,0.3)] transition-[border-color,box-shadow] focus-within:border-accent/30">
        <div className="flex items-end gap-1.5">
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
            aria-label="Attach"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
          <textarea
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={placeholder ?? "Message the room… use @ to mention an employee"}
            className="max-h-32 min-h-[40px] w-full flex-1 resize-none bg-transparent px-1 py-2 text-sm text-ink outline-none placeholder:text-ink-3"
          />
          <div className="flex shrink-0 items-center gap-0.5 pb-0.5">
            <button
              type="button"
              onClick={() => {
                setValue((v) => v + "@");
                setMentionQuery("");
                inputRef.current?.focus();
              }}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
              title="Mention employee"
            >
              <AtSign className="h-[17px] w-[17px]" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => setShowCommands((v) => !v)}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] font-mono text-base font-semibold text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
              title="Slash command"
            >
              /
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!value.trim() || disabled}
              className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-accent text-white shadow-[0_4px_12px_-5px_rgba(232,93,44,0.5)] transition-all hover:brightness-105 disabled:opacity-40 active:scale-95"
              aria-label="Send message"
            >
              <SendHorizontal className="h-[17px] w-[17px]" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
