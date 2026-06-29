"use client";

import { useRef, useState } from "react";
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
  { label: "Summarize room", text: "Summarize what we've decided so far in this room." },
  { label: "Create tasks from discussion", text: "@PM Employee turn our discussion into concrete tasks." },
  { label: "Save decision", text: "Save our latest decision to project memory." },
  { label: "Request approval", text: "@PM Employee request approval for the current plan." },
];

export function ChatComposer({
  employees,
  onSend,
  disabled,
  placeholder,
}: {
  employees: AIEmployee[];
  onSend: (text: string, mentionsJson?: MentionRef[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [trackedMentions, setTrackedMentions] = useState<MentionRef[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    const caret = e.target.selectionStart;
    const before = v.slice(0, caret);
    const match = before.match(/@(\w*)$/);
    setMentionQuery(match ? match[1] : null);
  };

  const insertMention = (emp: AIEmployee) => {
    setValue((prev) => prev.replace(/@(\w*)$/, `@${emp.name} `));
    setTrackedMentions((prev) => {
      if (prev.some((m) => m.id === emp.id)) return prev;
      return [...prev, { type: "ai_employee", id: emp.id, label: emp.name }];
    });
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const send = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text, trackedMentions.length ? trackedMentions : undefined);
    setValue("");
    setMentionQuery(null);
    setTrackedMentions([]);
  };

  const filteredMentions = employees.filter((e) =>
    mentionQuery === "" ? true : e.name.toLowerCase().includes((mentionQuery ?? "").toLowerCase()),
  );

  return (
    <div className="relative">
      <AnimatePresence>
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
            className="absolute bottom-full left-0 mb-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Quick commands
            </div>
            {employees.slice(0, 3).map((e) => (
              <button
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
              send();
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
            onClick={send}
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
