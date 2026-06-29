"use client";

import { useEffect, useRef, useState } from "react";
import { AIEmployee, MentionRef } from "@/lib/types";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { cn } from "@/lib/utils";
import {
  AtSign,
  Mic,
  Paperclip,
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
            className="absolute bottom-full left-0 mb-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Slash commands
            </div>
            {filteredSlash.map((c) => (
              <button
                type="button"
                key={c.cmd}
                onClick={() => insertSlash(c.example)}
                className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
              >
                <span className="text-sm font-medium text-slate-800">{c.cmd}</span>
                <span className="text-[11px] text-slate-500">{c.label}</span>
              </button>
            ))}
          </motion.div>
        )}

        {mentionQuery !== null && filteredMentions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 mb-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Mention an employee
            </div>
            {filteredMentions.map((e) => (
              <button
                type="button"
                key={e.id}
                onClick={() => insertMention(e)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-100"
              >
                <EmployeeAvatar employee={e} size="xs" showStatus={false} />
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-800">{e.name}</div>
                  <div className="truncate text-[11px] text-slate-500">{e.role}</div>
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
            className="absolute bottom-full left-0 mb-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Quick commands
            </div>
            {commandNotice && (
              <p className="px-2 py-1 text-[11px] text-accent-700">{commandNotice}</p>
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
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100"
              >
                <Sparkles className="h-3.5 w-3.5 text-accent-600" /> Ask {e.name}
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
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100"
              >
                <Slash className="h-3.5 w-3.5 text-slate-500" /> {c.label}
              </button>
            ))}
            <div className="border-t border-slate-100 px-2 py-1.5">
              <div className="text-[10px] font-medium text-slate-500">All slash commands</div>
              {SLASH_COMMANDS.map((c) => (
                <button
                  type="button"
                  key={c.cmd}
                  onClick={() => insertSlash(c.example)}
                  className="block w-full py-0.5 text-left text-[11px] text-slate-600 hover:text-accent-700"
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

      <div className="relative z-10 rounded-2xl border border-slate-200 bg-slate-50 p-2 transition-colors focus-within:border-accent-500/40">
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
          className="max-h-32 min-h-[40px] w-full resize-none bg-transparent px-2 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-500"
        />
        <div className="flex items-center gap-1 px-1">
          <ComposerButton icon={Slash} label="Commands" onClick={() => setShowCommands((v) => !v)} active={showCommands} />
          <ComposerButton
            icon={AtSign}
            label="Mention"
            onClick={() => {
              setValue((v) => v + "@");
              setMentionQuery("");
              inputRef.current?.focus();
            }}
          />
          <ComposerButton icon={Paperclip} label="Attach" onClick={() => {}} />
          <ComposerButton icon={Mic} label="Voice" onClick={() => {}} />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!value.trim() || disabled}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-xl bg-accent-600 px-3.5 text-sm font-medium text-white transition-all hover:bg-accent-500 disabled:opacity-40 active:scale-95"
          >
            Send <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ComposerButton({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: typeof AtSign;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700",
        active && "bg-accent-500/15 text-accent-700",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
