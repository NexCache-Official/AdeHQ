"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AIEmployee, MentionRef, SavedArtifactType, WorkspaceMemberRole } from "@/lib/types";
import { STATUS_META } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { BROWSER_RESEARCH_UI_COPY } from "@/lib/ai/browser-research/types";
import type { WorkMode } from "@/lib/ai/intelligence/intelligence-context";
import { resolveMessageMentions, type MentionParticipant } from "@/lib/mentions";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
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
  Globe,
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

const WORK_MODES: Array<{
  id: WorkMode;
  emoji: string;
  label: string;
  hint: string;
}> = [
  { id: "fast", emoji: "⚡", label: "Fast", hint: "Quick response with minimal reasoning" },
  { id: "standard", emoji: "⚖️", label: "Standard", hint: "Balanced speed and depth" },
  { id: "deep", emoji: "🧠", label: "Deep Thinking", hint: "More reasoning for complex decisions" },
  { id: "research", emoji: "🌍", label: "Research", hint: "Use current sources and research tools" },
  { id: "collaboration", emoji: "🤝", label: "Collaboration", hint: "Coordinate relevant teammates" },
];

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
  { cmd: "/prd", label: "Generate PRD artifact", example: "/prd ", implemented: true },
  { cmd: "/report", label: "Generate report artifact", example: "/report ", implemented: true },
  { cmd: "/brief", label: "Generate brief artifact", example: "/brief ", implemented: true },
  { cmd: "/proposal", label: "Generate proposal artifact", example: "/proposal ", implemented: true },
  { cmd: "/checklist", label: "Generate checklist artifact", example: "/checklist ", implemented: true },
  { cmd: "/decision", label: "Capture decision", example: "/memory Decision: ", implemented: true },
  { cmd: "/help", label: "Ask Maya / show help", example: "/help", implemented: true },
  { cmd: "/summary", label: "Summarize current topic", example: "/summary", implemented: true },
  { cmd: "/ask", label: "Draft an AI question", example: "/ask", implemented: true },
  { cmd: "/archive", label: "Archive current topic", example: "/archive", implemented: true },
  { cmd: "/assign", label: "Add employee to topic", example: "/assign @", implemented: true },
  { cmd: "/autopilot", label: "Run an objective autonomously", example: "/autopilot ", implemented: true },
];

const PLUS_ACTIONS = [
  { id: "upload", label: "Upload file", icon: Paperclip, implemented: true },
  { id: "task", label: "Create task", icon: CheckSquare, implemented: true, insert: "/task " },
  { id: "artifact", label: "Generate artifact", icon: FileText, implemented: true, insert: "/report " },
  { id: "memory", label: "Save memory", icon: Save, implemented: true, insert: "/memory " },
  { id: "maya", label: "Ask Maya", icon: Sparkles, implemented: true, insert: "@Maya " },
  { id: "decision", label: "Create decision", icon: MessageSquarePlus, implemented: true, insert: "/memory Decision: " },
  { id: "employee", label: "Add employee", icon: AtSign, implemented: true },
];

export type SlashCommandResult =
  | { type: "help" }
  | { type: "task"; title: string }
  | { type: "memory"; content: string }
  | { type: "summary" }
  | { type: "ask" }
  | { type: "archive" }
  | { type: "assign"; employeeId: string; employeeName: string }
  | { type: "autopilot"; objective: string; employeeId?: string; employeeName?: string }
  | { type: "send"; text: string };

const ARTIFACT_SLASH = /^\/(prd|report|brief|proposal|checklist)\b/i;

const ARTIFACT_LABELS: Record<string, string> = {
  prd: "Generate PRD",
  report: "Generate report",
  brief: "Generate brief",
  proposal: "Generate proposal",
  checklist: "Generate checklist",
};

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

  if (lower === "/autopilot" || lower === "/auto") {
    if (!args) return null;
    // Optional leading @Employee picks who runs it.
    const mentionMatch = args.match(/^@([^\s].*?)(?:\s+([\s\S]+))?$/);
    if (mentionMatch) {
      const name = mentionMatch[1].trim();
      const emp = employees.find(
        (e) => e.name.toLowerCase() === name.toLowerCase() || e.name.toLowerCase().startsWith(name.toLowerCase()),
      );
      if (emp && mentionMatch[2]?.trim()) {
        return { type: "autopilot", objective: mentionMatch[2].trim(), employeeId: emp.id, employeeName: emp.name };
      }
    }
    return { type: "autopilot", objective: args };
  }

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

type MentionHuman = {
  id: string;
  name: string;
  email?: string;
  role?: WorkspaceMemberRole;
};

type MentionPickerItem =
  | { kind: "ai"; employee: AIEmployee }
  | { kind: "human"; id: string; name: string; email?: string; role?: WorkspaceMemberRole };

const HUMAN_ROLE_LABELS: Record<WorkspaceMemberRole, string> = {
  admin: "Admin",
  member: "Member",
};

/** Single-line composer height; grows up to this before scrolling. */
const COMPOSER_TEXTAREA_MIN_PX = 44;
const COMPOSER_TEXTAREA_MAX_PX = 193;

function adjustComposerTextareaHeight(textarea: HTMLTextAreaElement): boolean {
  textarea.style.height = "0px";
  const scrollHeight = textarea.scrollHeight;
  const nextHeight = Math.min(
    Math.max(scrollHeight, COMPOSER_TEXTAREA_MIN_PX),
    COMPOSER_TEXTAREA_MAX_PX,
  );
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = scrollHeight > COMPOSER_TEXTAREA_MAX_PX ? "auto" : "hidden";
  return nextHeight > COMPOSER_TEXTAREA_MIN_PX + 2;
}

export function ChatComposer({
  employees,
  mentionHumans = [],
  onSend,
  onUploadFiles,
  disabled,
  placeholder,
  draftText,
  onDraftConsumed,
  onSlashCommand,
  contextFiles,
  artifactIntent,
  onContextConsumed,
  onAddEmployee,
  onTypingChange,
  browserResearchAvailable = false,
  browserResearchEnabled = false,
  onBrowserResearchEnabledChange,
  agentModeEnabled = false,
  onAgentModeEnabledChange,
  browserResearchEffectiveProvider,
  browserResearchTavilyConfigured = false,
  browserResearchLiveReady = false,
  browserResearchBusy = false,
}: {
  employees: AIEmployee[];
  mentionHumans?: MentionHuman[];
  onSend: (
    text: string,
    mentionsJson?: MentionRef[],
    attachmentFileIds?: string[],
    contextFileIds?: string[],
    workMode?: WorkMode,
  ) => void | Promise<void>;
  onUploadFiles?: (files: File[]) => Promise<ComposerUploadedFile[]>;
  onAddEmployee?: () => void;
  /** Broadcast local human typing for topic presence / AI pause. */
  onTypingChange?: (typing: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
  draftText?: string;
  onDraftConsumed?: () => void;
  onSlashCommand?: (result: SlashCommandResult) => void | Promise<void>;
  contextFiles?: Array<{ id: string; displayName: string }>;
  artifactIntent?: { type: SavedArtifactType; label: string } | null;
  onContextConsumed?: () => void;
  browserResearchAvailable?: boolean;
  browserResearchEnabled?: boolean;
  onBrowserResearchEnabledChange?: (enabled: boolean) => void;
  agentModeEnabled?: boolean;
  onAgentModeEnabledChange?: (enabled: boolean) => void;
  browserResearchEffectiveProvider?: import("@/lib/ai/browser-research").BrowserResearchProvider;
  browserResearchTavilyConfigured?: boolean;
  browserResearchLiveReady?: boolean;
  browserResearchBusy?: boolean;
}) {
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [trackedMentions, setTrackedMentions] = useState<MentionRef[]>([]);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [workMode, setWorkMode] = useState<WorkMode | undefined>();
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [sending, setSending] = useState(false);
  const sendInFlightRef = useRef(false);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [composerMultiline, setComposerMultiline] = useState(false);
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
    setComposerMultiline(adjustComposerTextareaHeight(input));
  }, [value]);

  const mentionParticipants = useMemo(
    (): MentionParticipant[] => [
      ...employees.map((e) => ({ id: e.id, name: e.name, type: "ai_employee" as const })),
      ...mentionHumans.map((h) => ({ id: h.id, name: h.name, type: "human" as const })),
    ],
    [employees, mentionHumans],
  );

  const filteredMentionItems = useMemo((): MentionPickerItem[] => {
    const query = (mentionQuery ?? "").toLowerCase();
    const items: MentionPickerItem[] = [];
    for (const employee of employees) {
      if (
        !query ||
        employee.name.toLowerCase().includes(query) ||
        employee.role.toLowerCase().includes(query)
      ) {
        items.push({ kind: "ai", employee });
      }
    }
    for (const human of mentionHumans) {
      if (
        !query ||
        human.name.toLowerCase().includes(query) ||
        human.email?.toLowerCase().includes(query)
      ) {
        items.push({ kind: "human", ...human });
      }
    }
    return items;
  }, [employees, mentionHumans, mentionQuery]);

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
    onTypingChange?.(next.trim().length > 0);
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
      setCommandNotice("File upload isn't available here. Open a topic to upload and ask about files.");
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

  const insertMention = (item: MentionPickerItem) => {
    const name = item.kind === "ai" ? item.employee.name : item.name;
    const id = item.kind === "ai" ? item.employee.id : item.id;
    const type = item.kind === "ai" ? "ai_employee" : "human";
    const input = inputRef.current;
    const caret = input?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const match = before.match(/@([\w\s.-]*)$/);
    const start = match ? before.length - match[0].length : before.length;
    const next = `${value.slice(0, start)}@${name} ${after}`;
    const nextCaret = start + name.length + 2;

    setValue(next);
    setTrackedMentions((prev) => {
      if (prev.some((m) => m.id === id && m.type === type)) return prev;
      return [...prev, { type, id, label: name }];
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
    if ((!text && attachments.length === 0) || disabled || sending || sendInFlightRef.current) return;
    if (waitingOnFiles) {
      setCommandNotice("Wait for attached files to finish processing before sending.");
      return;
    }
    if (failedFiles && readyAttachmentIds.length === 0 && !text) {
      setCommandNotice("Remove failed files or add a message before sending.");
      return;
    }

    const command = text.startsWith("/") ? SLASH_COMMANDS.find((item) => text.toLowerCase().startsWith(item.cmd)) : null;
    if (command && !command.implemented && !ARTIFACT_SLASH.test(text)) {
      setCommandNotice(command.notice ?? "That action arrives later in Phase 3.");
      return;
    }

    const slash = ARTIFACT_SLASH.test(text) ? null : parseSlashCommand(text, employees);
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
      setCommandNotice("Commands: /task /memory /summarize /prd /report /brief /proposal /checklist /ask /archive /assign.");
      setShowCommands(true);
      return;
    }

    const sendText =
      text ||
      (readyAttachmentIds.length
        ? `Uploaded ${attachments
            .filter((attachment) => readyAttachmentIds.includes(attachment.fileId ?? ""))
            .map((attachment) => attachment.fileName)
            .join(", ")}`
        : "");
    const { content: normalizedContent, mentionsJson } = resolveMessageMentions(
      sendText,
      mentionParticipants,
      trackedMentions,
    );
    const mentionsToSend = mentionsJson.length ? mentionsJson : undefined;
    const contextFileIdsToSend = contextFiles?.length ? contextFiles.map((file) => file.id) : undefined;
    const attachmentsSnapshot = [...attachments];

    sendInFlightRef.current = true;
    setSending(true);
    setValue("");
    setMentionQuery(null);
    setSlashQuery(null);
    setTrackedMentions([]);
    setCommandNotice(null);
    onTypingChange?.(false);

    try {
      await onSend(
        normalizedContent,
        mentionsToSend,
        readyAttachmentIds.length ? readyAttachmentIds : undefined,
        contextFileIdsToSend,
        workMode,
      );
      setWorkMode(undefined);
      setAttachments((prev) => prev.filter((attachment) => attachment.status === "failed"));
      onContextConsumed?.();
    } catch {
      setValue(sendText);
      setTrackedMentions(mentionsToSend ?? []);
      setAttachments(attachmentsSnapshot);
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  };

  const canSend = (!!value.trim() || attachments.length > 0) && !disabled && !sending;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filteredMentionItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveMentionIndex((index) => (index + 1) % filteredMentionItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveMentionIndex(
          (index) => (index - 1 + filteredMentionItems.length) % filteredMentionItems.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMentionItems[activeMentionIndex]);
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

        {mentionQuery !== null && filteredMentionItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-0 z-20 mb-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-panel"
          >
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              Mention someone
            </div>
            {filteredMentionItems.map((item, index) => (
              <button
                type="button"
                key={item.kind === "ai" ? item.employee.id : item.id}
                onClick={() => insertMention(item)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                  index === activeMentionIndex ? "bg-muted" : "hover:bg-muted",
                )}
              >
                {item.kind === "ai" ? (
                  <>
                    <EmployeeAvatar employee={item.employee} size="xs" showStatus={false} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{item.employee.name}</div>
                      <div className="truncate text-[11px] text-ink-3">{item.employee.role}</div>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-3">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          STATUS_META[item.employee.status].dot,
                        )}
                      />
                      {STATUS_META[item.employee.status].label}
                    </span>
                  </>
                ) : (
                  <>
                    <HumanAvatar name={item.name} size="xs" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{item.name}</div>
                      <div className="truncate text-[11px] text-ink-3">
                        {item.email ?? "Workspace member"}
                      </div>
                    </div>
                    {item.role && (
                      <span className="shrink-0 text-[10px] text-ink-3">
                        {HUMAN_ROLE_LABELS[item.role]}
                      </span>
                    )}
                  </>
                )}
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
                    if (action.id === "employee") {
                      onAddEmployee?.();
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

      <div className="relative z-10 rounded-[15px] border border-border bg-surface p-1 shadow-[0_8px_26px_-18px_rgba(40,30,15,0.3)] transition-[border-color,box-shadow] focus-within:border-accent/30">
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

        {(contextFiles?.length || artifactIntent || browserResearchEnabled || agentModeEnabled) && (
          <div className="mb-1 flex flex-wrap gap-1.5 px-1">
            {browserResearchEnabled && (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">
                <Globe className="h-3 w-3" />
                {BROWSER_RESEARCH_UI_COPY.fastSearchBadge}
              </span>
            )}
            {agentModeEnabled && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                <Sparkles className="h-3 w-3" />
                {browserResearchLiveReady
                  ? BROWSER_RESEARCH_UI_COPY.liveBadge
                  : BROWSER_RESEARCH_UI_COPY.previewModeBadge}
              </span>
            )}
            {artifactIntent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                <FileText className="h-3 w-3" />
                {artifactIntent.label}
              </span>
            )}
            {contextFiles?.map((file) => (
              <span
                key={file.id}
                className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700"
              >
                <Paperclip className="h-3 w-3" />
                {file.displayName}
              </span>
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

        <div className="mb-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
          {WORK_MODES.map((mode) => {
            const selected = workMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setWorkMode(selected ? undefined : mode.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors",
                  selected
                    ? "border-accent/30 bg-accent-soft text-accent-d"
                    : "border-border bg-surface text-ink-3 hover:bg-muted hover:text-ink-2",
                )}
                title={mode.hint}
                aria-pressed={selected}
              >
                <span aria-hidden>{mode.emoji}</span>
                {mode.label}
              </button>
            );
          })}
        </div>

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

        <div className={cn("flex gap-1.5", composerMultiline ? "items-end" : "items-center")}>
          <button
            type="button"
            onClick={() => setShowPlusMenu((open) => !open)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
            aria-label="Open add menu"
            title="Add"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-[11px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 sm:flex"
            aria-label="Attach file"
            title="Attach file"
          >
            <Paperclip className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <textarea
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={() => onTypingChange?.(false)}
            onPaste={(event) => {
              if (event.clipboardData.files.length > 0) addFiles(event.clipboardData.files);
            }}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? "Message the room… use @ to mention an employee"}
            className="min-h-0 w-full flex-1 resize-none overflow-hidden bg-transparent px-1 py-2 text-[14px] leading-[1.5] text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              disabled
              className="hidden h-8 w-8 cursor-not-allowed items-center justify-center rounded-[11px] text-ink-3 opacity-45 sm:flex"
              title="Emoji reactions arrive later"
              aria-label="Emoji"
            >
              <Smile className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => setShowFormatting((open) => !open)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-[11px] transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40",
                showFormatting ? "bg-muted text-ink-2" : "text-ink-3",
              )}
              title="Formatting"
              aria-label="Toggle formatting"
            >
              <Type className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => {
                setValue((current) => `${current}@`);
                setMentionQuery("");
                inputRef.current?.focus();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-[11px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
              title="Mention employee"
              aria-label="Mention employee"
            >
              <AtSign className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => setShowCommands((open) => !open)}
              className="flex h-8 w-8 items-center justify-center rounded-[11px] font-mono text-base font-semibold text-ink-3 transition-colors hover:bg-muted hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
              title="Slash command"
              aria-label="Open slash commands"
            >
              /
            </button>
            {browserResearchAvailable && (
              <button
                type="button"
                disabled={disabled || browserResearchBusy}
                onClick={() => {
                  onBrowserResearchEnabledChange?.(!browserResearchEnabled);
                  if (!browserResearchEnabled) onAgentModeEnabledChange?.(false);
                }}
                className={cn(
                  "flex h-8 items-center gap-1 rounded-[11px] px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40",
                  browserResearchEnabled
                    ? "bg-sky-600 text-white hover:bg-sky-700"
                    : "text-ink-3 hover:bg-muted hover:text-ink-2",
                )}
                title={
                  browserResearchEnabled
                    ? BROWSER_RESEARCH_UI_COPY.agentModeOnHint
                    : BROWSER_RESEARCH_UI_COPY.agentModeOffHint
                }
                aria-pressed={browserResearchEnabled}
                aria-label="Toggle fast web search (Tavily)"
              >
                <Globe className="h-3.5 w-3.5" />
                {BROWSER_RESEARCH_UI_COPY.agentModeLabel}
              </button>
            )}
            {browserResearchAvailable && browserResearchLiveReady && (
              <button
                type="button"
                disabled={disabled || browserResearchBusy}
                onClick={() => {
                  onAgentModeEnabledChange?.(!agentModeEnabled);
                  if (!agentModeEnabled) onBrowserResearchEnabledChange?.(false);
                }}
                className={cn(
                  "flex h-8 items-center gap-1 rounded-[11px] px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40",
                  agentModeEnabled
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "text-ink-3 hover:bg-muted hover:text-ink-2",
                )}
                title={
                  agentModeEnabled
                    ? BROWSER_RESEARCH_UI_COPY.liveAgentModeOnHint
                    : BROWSER_RESEARCH_UI_COPY.liveAgentModeOffHint
                }
                aria-pressed={agentModeEnabled}
                aria-label="Toggle live browser agent mode (Browserbase)"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {BROWSER_RESEARCH_UI_COPY.liveAgentModeLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-accent text-white shadow-[0_4px_12px_-5px_rgba(47,111,237,0.5)] transition-all hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:opacity-40 active:scale-95"
              aria-label="Send message"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <SendHorizontal className="h-4 w-4" strokeWidth={2} />
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
      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
    >
      {icon}
    </button>
  );
}
