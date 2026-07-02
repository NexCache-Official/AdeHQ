"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AIEmployee, MentionRef } from "@/lib/types";
import { STATUS_META } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { FileArtifactCard } from "./ArtifactCard";
import {
  AtSign,
  Bold,
  CheckSquare,
  ChevronDown,
  Code2,
  FileText,
  Italic,
  Link,
  List,
  ListOrdered,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Plus,
  Quote,
  Save,
  SendHorizontal,
  Slash,
  Smile,
  Sparkles,
  Type,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export type ComposerUploadedFile = {
  id: string;
  displayName: string;
  extension: string;
  sizeBytes: number;
  status: "ready" | "failed" | "processing" | "uploaded";
  parseStatus?: "pending" | "processing" | "parsed" | "no_text" | "failed" | null;
  errorMessage?: string | null;
};

type ComposerAttachment = {
  localId: string;
  fileId?: string;
  fileName: string;
  extension: string;
  sizeLabel: string;
  status: "uploading" | "processing" | "ready" | "failed" | "attached";
  error?: string | null;
};

type SlashCommand = {
  cmd: string;
  label: string;
  example: string;
  implemented: boolean;
  notice?: string;
};

const QUICK_COMMANDS = [
  { label: "Summarize topic", text: "/summarize" },
  { label: "Create task", text: "/task " },
  { label: "Save memory", text: "/memory " },
  { label: "Draft report", text: "/report " },
];

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/task", label: "Create task from message", example: "/task ", implemented: true },
  { cmd: "/memory", label: "Save note to memory", example: "/memory ", implemented: true },
  { cmd: "/summarize", label: "Summarize current topic", example: "/summarize", implemented: true },
  { cmd: "/prd", label: "Generate PRD artifact", example: "/prd ", implemented: false, notice: "PRD artifacts arrive in V19.6.2." },
  { cmd: "/report", label: "Generate report artifact", example: "/report ", implemented: false, notice: "Report artifacts arrive in V19.6.2." },
  { cmd: "/brief", label: "Generate brief artifact", example: "/brief ", implemented: false, notice: "Brief artifacts arrive in V19.6.2." },
  { cmd: "/proposal", label: "Generate proposal artifact", example: "/proposal ", implemented: false, notice: "Proposal artifacts arrive in V19.6.2." },
  { cmd: "/decision", label: "Capture decision", example: "/memory Decision: ", implemented: true },
  { cmd: "/help", label: "Ask Maya / show help", example: "/help", implemented: true },
  { cmd: "/summary", label: "Summarize current topic", example: "/summary", implemented: true },
  { cmd: "/ask", label: "Draft an AI question", example: "/ask", implemented: true },
  { cmd: "/archive", label: "Archive current topic", example: "/archive", implemented: true },
  { cmd: "/assign", label: "Add employee to topic", example: "/assign @", implemented: true },
];

const PLUS_ACTIONS = [
  { id: "upload", label: "Upload file", icon: Paperclip, implemented: true },
  { id: "task", label: "Create task", icon: CheckSquare, implemented: true, insert: "/task " },
  { id: "artifact", label: "Generate artifact", icon: FileText, implemented: false },
  { id: "memory", label: "Save memory", icon: Save, implemented: true, insert: "/memory " },
  { id: "maya", label: "Ask Maya", icon: Sparkles, implemented: true, insert: "@Maya " },
  { id: "decision", label: "Create decision", icon: MessageSquarePlus, implemented: true, insert: "/memory Decision: " },
  { id: "employee", label: "Add employee", icon: AtSign, implemented: false },
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

  if (lower === "/memory" || lower === "/decision") {
    if (!args) return null;
    return { type: "memory", content: lower === "/decision" ? `Decision: ${args}` : args };
  }

  if (lower === "/summary" || lower === "/summarize") return { type: "summary" };

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function extensionFor(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "file";
}

export function ChatComposer({
  employees,
  onSend,
  onUploadFiles,
  disabled,
  placeholder,
  draftText,
  onDraftConsumed,
  onSlashCommand,
}: {
  employees: AIEmployee[];
  onSend: (text: string, mentionsJson?: MentionRef[], attachmentFileIds?: string[]) => void | Promise<void>;
  onUploadFiles?: (files: File[]) => Promise<ComposerUploadedFile[]>;
  disabled?: boolean;
  placeholder?: string;
  draftText?: string;
  onDraftConsumed?: () => void;
  onSlashCommand?: (result: SlashCommandResult) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [trackedMentions, setTrackedMentions] = useState<MentionRef[]>([]);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [sending, setSending] = useState(false);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!draftText) return;
    setValue(draftText);
    setMentionQuery(null);
    setSlashQuery(null);
    inputRef.current?.focus();
    onDraftConsumed?.();
  }, [draftText, onDraftConsumed]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
  }, [value]);

  const filteredMentions = useMemo(
    () =>
      employees.filter((e) => {
        const query = (mentionQuery ?? "").toLowerCase();
        return !query || e.name.toLowerCase().includes(query) || e.role.toLowerCase().includes(query);
      }),
    [employees, mentionQuery],
  );

  const filteredSlash = useMemo(
    () =>
      slashQuery === null
        ? []
        : SLASH_COMMANDS.filter((c) =>
            slashQuery === "/" ? true : c.cmd.toLowerCase().startsWith(slashQuery.toLowerCase()),
          ),
    [slashQuery],
  );

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionQuery]);

  useEffect(() => {
    setActiveSlashIndex(0);
  }, [slashQuery]);

  const updateQueryState = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const mentionMatch = before.match(/@([\w .-]*)$/);
    const slashMatch = before.match(/(?:^|\s)(\/[\w-]*)$/);
    setMentionQuery(mentionMatch ? mentionMatch[1] : null);
    setSlashQuery(slashMatch ? slashMatch[1] : null);
    if (slashMatch) setShowCommands(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    updateQueryState(next, e.target.selectionStart);
  };

  const addFiles = (files: FileList | File[]) => {
    const nextFiles = Array.from(files);
    if (!nextFiles.length) return;
    const staged = nextFiles.map((file) => ({
      localId: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fileName: file.name,
      extension: extensionFor(file.name),
      sizeLabel: formatFileSize(file.size),
      status: onUploadFiles ? ("uploading" as const) : ("attached" as const),
    }));
    setAttachments((prev) => [...prev, ...staged]);

    if (!onUploadFiles) {
      setCommandNotice("Files are staged here now. Upload and file Q&A arrive in V19.6.1.");
      return;
    }

    void Promise.all(
      nextFiles.map(async (file, index) => {
        const localId = staged[index].localId;
        try {
          const [uploaded] = await onUploadFiles([file]);
          setAttachments((prev) =>
            prev.map((attachment) =>
              attachment.localId === localId
                ? {
                    ...attachment,
                    fileId: uploaded.id,
                    fileName: uploaded.displayName,
                    extension: uploaded.extension,
                    sizeLabel: formatFileSize(uploaded.sizeBytes),
                    status:
                      uploaded.status === "ready"
                        ? "ready"
                        : uploaded.status === "failed"
                          ? "failed"
                          : "processing",
                    error:
                      uploaded.parseStatus === "no_text"
                        ? "No extractable text found."
                        : uploaded.errorMessage ?? null,
                  }
                : attachment,
            ),
          );
        } catch (error) {
          setAttachments((prev) =>
            prev.map((attachment) =>
              attachment.localId === localId
                ? {
                    ...attachment,
                    status: "failed",
                    error: error instanceof Error ? error.message : "Upload failed.",
                  }
                : attachment,
            ),
          );
        }
      }),
    );
  };

  const insertText = (text: string) => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const next = `${before}${text}${after}`;
    setValue(next);
    setShowPlusMenu(false);
    requestAnimationFrame(() => {
      const nextCaret = caret + text.length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
      updateQueryState(next, nextCaret);
    });
  };

  const insertMention = (emp: AIEmployee) => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const match = before.match(/@([\w\s.-]*)$/);
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

  const insertSlash = (command: SlashCommand) => {
    if (!command.implemented) {
      setCommandNotice(command.notice ?? "That action arrives later in Phase 3.");
      setSlashQuery(null);
      return;
    }

    const input = inputRef.current;
    const caret = input?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const match = before.match(/(?:^|\s)(\/[\w-]*)$/);
    const start = match ? before.length - match[0].length : before.length;
    const prefix = match ? before.slice(0, start) : before;
    const next = `${prefix}${command.example}${after}`;
    const nextCaret = `${prefix}${command.example}`.length;
    setValue(next);
    setSlashQuery(null);
    setShowCommands(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const applyFormat = (prefix: string, suffix = prefix, fallback = "text") => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || fallback;
    const next = `${value.slice(0, start)}${prefix}${selected}${suffix}${value.slice(end)}`;
    setValue(next);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  };

  const applyLinePrefix = (prefix: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const next = `${value.slice(0, lineStart)}${prefix}${value.slice(lineStart)}`;
    setValue(next);
    requestAnimationFrame(() => {
      const nextCaret = start + prefix.length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const send = async () => {
    const readyAttachmentIds = attachments
      .filter((attachment) => attachment.fileId && attachment.status === "ready")
      .map((attachment) => attachment.fileId as string);
    const waitingOnFiles = attachments.some((attachment) =>
      ["uploading", "processing", "attached"].includes(attachment.status),
    );
    const failedFiles = attachments.some((attachment) => attachment.status === "failed");
    const text = value.trim();
    if ((!text && attachments.length === 0) || disabled || sending) return;
    if (waitingOnFiles) {
      setCommandNotice("Wait for attached files to finish processing before sending.");
      return;
    }
    if (failedFiles && readyAttachmentIds.length === 0 && !text) {
      setCommandNotice("Remove failed files or add a message before sending.");
      return;
    }

    const command = text.startsWith("/") ? SLASH_COMMANDS.find((item) => text.toLowerCase().startsWith(item.cmd)) : null;
    if (command && !command.implemented) {
      setCommandNotice(command.notice ?? "That action arrives later in Phase 3.");
      return;
    }

    const slash = parseSlashCommand(text, employees);
    if (slash && onSlashCommand) {
      if (slash.type !== "help") {
        setValue("");
        setMentionQuery(null);
        setSlashQuery(null);
        setTrackedMentions([]);
        setCommandNotice(null);
        await onSlashCommand(slash);
        return;
      }
      setCommandNotice("Commands: /task /memory /summarize /ask /archive /assign. Artifact commands unlock in V19.6.2.");
      setShowCommands(true);
      return;
    }

    setSending(true);
    try {
      const sendText =
        text ||
        (readyAttachmentIds.length
          ? `Uploaded ${attachments
              .filter((attachment) => readyAttachmentIds.includes(attachment.fileId ?? ""))
              .map((attachment) => attachment.fileName)
              .join(", ")}`
          : "");
      await onSend(
        sendText,
        trackedMentions.length ? trackedMentions : undefined,
        readyAttachmentIds.length ? readyAttachmentIds : undefined,
      );
      setValue("");
      setMentionQuery(null);
      setSlashQuery(null);
      setTrackedMentions([]);
      setAttachments((prev) => prev.filter((attachment) => attachment.status === "failed"));
      setCommandNotice(null);
    } finally {
      setSending(false);
    }
  };

  const canSend = (!!value.trim() || attachments.length > 0) && !disabled && !sending;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveMentionIndex((index) => (index + 1) % filteredMentions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveMentionIndex((index) => (index - 1 + filteredMentions.length) % filteredMentions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMentions[activeMentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (slashQuery !== null && filteredSlash.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSlashIndex((index) => (index + 1) % filteredSlash.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSlashIndex((index) => (index - 1 + filteredSlash.length) % filteredSlash.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertSlash(filteredSlash[activeSlashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashQuery(null);
        setShowCommands(false);
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      applyFormat("**", "**", "bold text");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
      e.preventDefault();
      applyFormat("*", "*", "italic text");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      applyFormat("[", "](https://)", "link text");
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div
      className="relative"
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md"
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <AnimatePresence>
        {dragActive && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="absolute inset-0 z-30 flex items-center justify-center rounded-[17px] border border-dashed border-accent bg-accent-soft/95 text-sm font-semibold text-accent-d"
          >
            Drop files to stage them
          </motion.div>
        )}

        {slashQuery !== null && filteredSlash.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 z-20 mb-2 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              Slash commands
            </div>
            {filteredSlash.map((command, index) => (
              <button
                type="button"
                key={command.cmd}
                onClick={() => insertSlash(command)}
                disabled={!command.implemented}
                className={cn(
                  "flex w-full flex-col rounded-lg px-2 py-1.5 text-left transition-colors",
                  index === activeSlashIndex ? "bg-muted" : "hover:bg-muted",
                  !command.implemented && "cursor-not-allowed opacity-55",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2 text-sm font-medium text-ink">
                  {command.cmd}
                  {!command.implemented && <span className="text-[10px] font-semibold text-ink-3">Soon</span>}
                </span>
                <span className="text-[11px] text-ink-3">{command.label}</span>
              </button>
            ))}
          </motion.div>
        )}

        {mentionQuery !== null && filteredMentions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 z-20 mb-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              Mention an employee
            </div>
            {filteredMentions.map((employee, index) => (
              <button
                type="button"
                key={employee.id}
                onClick={() => insertMention(employee)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                  index === activeMentionIndex ? "bg-muted" : "hover:bg-muted",
                )}
              >
                <EmployeeAvatar employee={employee} size="xs" showStatus={false} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{employee.name}</div>
                  <div className="truncate text-[11px] text-ink-3">{employee.role}</div>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-3">
                  <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[employee.status].dot)} />
                  {STATUS_META[employee.status].label}
                </span>
              </button>
            ))}
          </motion.div>
        )}

        {showCommands && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 z-20 mb-2 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              Quick commands
            </div>
            {commandNotice && <p className="px-2 py-1 text-[11px] text-accent-d">{commandNotice}</p>}
            {employees.slice(0, 3).map((employee) => (
              <button
                type="button"
                key={employee.id}
                onClick={() => {
                  setValue(`@${employee.name} `);
                  setTrackedMentions((prev) => {
                    if (prev.some((m) => m.id === employee.id)) return prev;
                    return [...prev, { type: "ai_employee", id: employee.id, label: employee.name }];
                  });
                  setShowCommands(false);
                  inputRef.current?.focus();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-muted"
              >
                <Sparkles className="h-3.5 w-3.5 text-accent" /> Ask {employee.name}
              </button>
            ))}
            {QUICK_COMMANDS.map((command) => (
              <button
                type="button"
                key={command.label}
                onClick={() => {
                  setValue(command.text);
                  setShowCommands(false);
                  inputRef.current?.focus();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-muted"
              >
                <Slash className="h-3.5 w-3.5 text-ink-3" /> {command.label}
              </button>
            ))}
          </motion.div>
        )}

        {showPlusMenu && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 z-20 mb-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              Add to message
            </div>
            {PLUS_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  type="button"
                  key={action.id}
                  disabled={!action.implemented}
                  onClick={() => {
                    if (action.id === "upload") {
                      fileInputRef.current?.click();
                      setShowPlusMenu(false);
                      return;
                    }
                    if (action.insert) insertText(action.insert);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-muted",
                    !action.implemented && "cursor-not-allowed opacity-55",
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-ink-3" />
                    {action.label}
                  </span>
                  {!action.implemented && <span className="text-[10px] font-semibold text-ink-3">Soon</span>}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {(showCommands || showPlusMenu) && <div className="fixed inset-0 z-10" onClick={() => {
        setShowCommands(false);
        setShowPlusMenu(false);
      }} />}

      <div className="relative z-10 rounded-[17px] border border-border bg-surface p-1.5 shadow-[0_8px_26px_-18px_rgba(40,30,15,0.3)] transition-[border-color,box-shadow] focus-within:border-accent/30">
        {commandNotice && (
          <div className="mb-1 flex items-center justify-between gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[11px] text-accent-d">
            <span>{commandNotice}</span>
            <button type="button" onClick={() => setCommandNotice(null)} className="rounded-md p-1 hover:bg-white/45">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-1.5 grid gap-1.5 sm:grid-cols-2">
            {attachments.map((file, index) => (
              <FileArtifactCard
                key={file.localId}
                fileName={file.fileName}
                extension={file.extension}
                size={file.error ? file.error : file.sizeLabel}
                status={file.status}
                onRemove={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        )}

        {trackedMentions.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1.5 px-1">
            {trackedMentions.map((mention) => (
              <button
                key={mention.id}
                type="button"
                onClick={() => setTrackedMentions((prev) => prev.filter((item) => item.id !== mention.id))}
                className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-d"
              >
                @{mention.label}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

        {showFormatting && (
          <div className="mb-1 flex flex-wrap gap-0.5 border-b border-border-2 px-1 pb-1">
            <FormatButton label="Bold" onClick={() => applyFormat("**", "**", "bold text")} icon={<Bold className="h-3.5 w-3.5" />} />
            <FormatButton label="Italic" onClick={() => applyFormat("*", "*", "italic text")} icon={<Italic className="h-3.5 w-3.5" />} />
            <FormatButton label="Code" onClick={() => applyFormat("`", "`", "code")} icon={<Code2 className="h-3.5 w-3.5" />} />
            <FormatButton label="Link" onClick={() => applyFormat("[", "](https://)", "link text")} icon={<Link className="h-3.5 w-3.5" />} />
            <FormatButton label="Bullet list" onClick={() => applyLinePrefix("- ")} icon={<List className="h-3.5 w-3.5" />} />
            <FormatButton label="Numbered list" onClick={() => applyLinePrefix("1. ")} icon={<ListOrdered className="h-3.5 w-3.5" />} />
            <FormatButton label="Checklist" onClick={() => applyLinePrefix("- [ ] ")} icon={<CheckSquare className="h-3.5 w-3.5" />} />
            <FormatButton label="Quote" onClick={() => applyLinePrefix("> ")} icon={<Quote className="h-3.5 w-3.5" />} />
          </div>
        )}

        <div className="flex items-end gap-1.5">
          <button
            type="button"
            onClick={() => setShowPlusMenu((open) => !open)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
            aria-label="Open add menu"
            title="Add"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2 sm:flex"
            aria-label="Attach file"
            title="Attach file"
          >
            <Paperclip className="h-[17px] w-[17px]" strokeWidth={1.8} />
          </button>
          <textarea
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={(event) => {
              if (event.clipboardData.files.length > 0) addFiles(event.clipboardData.files);
            }}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? "Message the room… use @ to mention an employee"}
            className="max-h-[168px] min-h-[40px] w-full flex-1 resize-none bg-transparent px-1 py-2 text-sm text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex shrink-0 items-center gap-0.5 pb-0.5">
            <button
              type="button"
              disabled
              className="hidden h-[34px] w-[34px] cursor-not-allowed items-center justify-center rounded-[10px] text-ink-3 opacity-45 sm:flex"
              title="Emoji reactions arrive later"
              aria-label="Emoji"
            >
              <Smile className="h-[17px] w-[17px]" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => setShowFormatting((open) => !open)}
              className={cn(
                "flex h-[34px] w-[34px] items-center justify-center rounded-[10px] transition-colors hover:bg-muted hover:text-ink-2",
                showFormatting ? "bg-muted text-ink-2" : "text-ink-3",
              )}
              title="Formatting"
              aria-label="Toggle formatting"
            >
              <Type className="h-[17px] w-[17px]" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => {
                setValue((current) => `${current}@`);
                setMentionQuery("");
                inputRef.current?.focus();
              }}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
              title="Mention employee"
              aria-label="Mention employee"
            >
              <AtSign className="h-[17px] w-[17px]" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => setShowCommands((open) => !open)}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] font-mono text-base font-semibold text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
              title="Slash command"
              aria-label="Open slash commands"
            >
              /
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-accent text-white shadow-[0_4px_12px_-5px_rgba(232,93,44,0.5)] transition-all hover:brightness-105 disabled:opacity-40 active:scale-95"
              aria-label="Send message"
            >
              {sending ? (
                <Loader2 className="h-[17px] w-[17px] animate-spin" strokeWidth={2} />
              ) : (
                <SendHorizontal className="h-[17px] w-[17px]" strokeWidth={2} />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-1.5 hidden flex-wrap items-center gap-1.5 px-1 text-[11px] text-ink-3 sm:flex">
        {QUICK_COMMANDS.slice(0, 3).map((command) => (
          <button
            key={command.label}
            type="button"
            onClick={() => {
              setValue(command.text);
              inputRef.current?.focus();
            }}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 transition-colors hover:bg-muted hover:text-ink-2"
          >
            <ChevronDown className="h-3 w-3 rotate-[-90deg]" />
            {command.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FormatButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-muted hover:text-ink"
    >
      {icon}
    </button>
  );
}
