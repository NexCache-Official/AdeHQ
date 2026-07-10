import { ModelResponseSchema } from "./schemas";
import type { EmployeeResponse } from "./types";
import { coerceToolCall } from "@/lib/integrations/coerce-tool-args";

type ParsedEffects = EmployeeResponse["effect"];

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found.");
  return JSON.parse(candidate.slice(start, end + 1));
}

const WORKLOG_STATUS_MAP: Record<string, ParsedEffects["workLog"][number]["status"]> = {
  success: "success",
  pending: "pending",
  failed: "failed",
  needs_approval: "needs_approval",
  in_progress: "pending",
  running: "pending",
  complete: "success",
  completed: "success",
};

function normalizeWorkLog(raw: unknown): ParsedEffects["workLog"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const statusRaw = String(item.status ?? "success").toLowerCase();
      return {
        action: String(item.action ?? "note"),
        summary: item.summary ? String(item.summary) : undefined,
        toolUsed: item.toolUsed ? String(item.toolUsed) : undefined,
        status: WORKLOG_STATUS_MAP[statusRaw] ?? "success",
        relatedEntityType: item.relatedEntityType as ParsedEffects["workLog"][number]["relatedEntityType"],
      };
    });
}

function normalizeTasks(raw: unknown): ParsedEffects["tasks"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const statusRaw = String(item.status ?? "open").toLowerCase();
      const mappedStatus =
        statusRaw === "in_progress" || statusRaw === "running" ? "in_progress" : statusRaw;
      const allowed = ["open", "in_progress", "waiting_approval", "blocked", "done"] as const;
      const status = allowed.includes(mappedStatus as (typeof allowed)[number])
        ? (mappedStatus as ParsedEffects["tasks"][number]["status"])
        : "open";
      return {
        title: String(item.title ?? "Task"),
        description: item.description ? String(item.description) : undefined,
        status,
        priority: (["low", "medium", "high"].includes(String(item.priority))
          ? item.priority
          : "medium") as ParsedEffects["tasks"][number]["priority"],
        assigneeType: (item.assigneeType === "human" ? "human" : "ai") as "human" | "ai",
        assigneeId: item.assigneeId ? String(item.assigneeId) : undefined,
        createdFrom: item.createdFrom ? String(item.createdFrom) : undefined,
      };
    });
}

function normalizeMemory(raw: unknown): ParsedEffects["memory"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      type: item.type as ParsedEffects["memory"][number]["type"],
      title: String(item.title ?? "Note"),
      content: String(item.content ?? ""),
      status: (item.status as ParsedEffects["memory"][number]["status"]) ?? "draft",
    }));
}

function normalizeApprovals(raw: unknown): ParsedEffects["approvals"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      title: String(item.title ?? "Approval"),
      description: item.description ? String(item.description) : undefined,
      risk: (item.risk as ParsedEffects["approvals"][number]["risk"]) ?? "medium",
      actionType: item.actionType as ParsedEffects["approvals"][number]["actionType"],
    }));
}

function normalizeToolCalls(raw: unknown): NonNullable<ParsedEffects["toolCalls"]> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .filter((item) => typeof item.tool === "string" && (item.tool as string).includes("."))
    .map((item) => coerceToolCall(String(item.tool), item));
}

function normalizeAutopilot(raw: unknown): ParsedEffects["autopilot"] {
  if (!raw || typeof raw !== "object") return undefined;
  const item = raw as Record<string, unknown>;
  const objective = typeof item.objective === "string" ? item.objective.trim() : "";
  if (!objective) return undefined;
  const mode = item.mode === "start" ? "start" : "offer";
  return {
    mode,
    objective,
    employeeName: typeof item.employeeName === "string" ? item.employeeName : undefined,
  };
}

function normalizeEmailDrafts(raw: unknown): NonNullable<ParsedEffects["emailDrafts"]> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      subject: String(item.subject ?? "Draft"),
      body: String(item.body ?? ""),
      recipient: item.recipient ? String(item.recipient) : undefined,
      company: item.company ? String(item.company) : undefined,
    }))
    .filter((d) => d.body.trim().length > 0);
}

function normalizePassthroughArray<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : [];
}

function normalizeEffects(raw: unknown): ParsedEffects {
  const effects =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const handoff = effects.handoffTo;
  return {
    workLog: normalizeWorkLog(effects.workLog),
    tasks: normalizeTasks(effects.tasks),
    memory: normalizeMemory(effects.memory),
    memorySuggestions: normalizePassthroughArray<NonNullable<ParsedEffects["memorySuggestions"]>[number]>(
      effects.memorySuggestions,
    ),
    citations: normalizePassthroughArray<NonNullable<ParsedEffects["citations"]>[number]>(
      effects.citations,
    ),
    artifacts: normalizePassthroughArray<NonNullable<ParsedEffects["artifacts"]>[number]>(
      effects.artifacts,
    ),
    approvals: normalizeApprovals(effects.approvals),
    emailDrafts: normalizeEmailDrafts(effects.emailDrafts),
    toolCalls: normalizeToolCalls(effects.toolCalls),
    autopilot: normalizeAutopilot(effects.autopilot),
    statusChange: effects.statusChange as ParsedEffects["statusChange"],
    handoffTo: Array.isArray(handoff)
      ? handoff.filter((v): v is string => typeof v === "string")
      : typeof handoff === "string" && handoff
        ? [handoff]
        : undefined,
    currentTask: effects.currentTask ? String(effects.currentTask) : undefined,
  };
}

/** Lenient parse — fixes common model mistakes before Zod validation. */
export function parseModelResponseText(
  text: string,
): Pick<EmployeeResponse, "reply" | "effect"> | null {
  try {
    const raw = extractJsonObject(text);
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const reply = obj.reply ?? obj.message ?? obj.content;
    if (typeof reply !== "string" || !reply.trim()) return null;

    const effectsRaw = obj.effects ?? obj.effect ?? {};
    const normalized = normalizeEffects(effectsRaw);
    const validated = ModelResponseSchema.safeParse({ reply: reply.trim(), effects: normalized });
    if (validated.success) {
      return {
        reply: validated.data.reply,
        effect: {
          workLog: validated.data.effects.workLog,
          tasks: validated.data.effects.tasks,
          memory: validated.data.effects.memory,
          memorySuggestions: validated.data.effects.memorySuggestions,
          citations: validated.data.effects.citations,
          artifacts: validated.data.effects.artifacts,
          approvals: validated.data.effects.approvals,
          emailDrafts: validated.data.effects.emailDrafts,
          toolCalls: validated.data.effects.toolCalls,
          autopilot: validated.data.effects.autopilot,
          statusChange: validated.data.effects.statusChange,
          handoffTo: validated.data.effects.handoffTo,
          currentTask: validated.data.effects.currentTask,
        },
      };
    }

    return { reply: reply.trim(), effect: normalized };
  } catch {
    return null;
  }
}

/**
 * Some models occasionally narrate intended tool calls as literal schema-like
 * text directly inside the reply field — e.g. "effects.toolCalls: tool:
 * crm.createContact mode: execute args: ..." — instead of populating the real
 * structured effects. This is a model failure mode (not a JSON parsing bug):
 * the "reply" string is technically valid, so it sails through schema
 * validation carrying the leak, and the real effects.toolCalls stays empty
 * (which is also why the underlying action fails to execute). Detect and cut
 * the reply off before any such leak, on every path that produces a reply.
 */
const SCHEMA_LEAK_MARKER =
  /\beffects\s*\.\s*\w+\s*:|\beffects\s*:\s*\{|(?:^|[\s.])tool\s*:\s*[a-zA-Z][\w-]*\.[a-zA-Z][\w-]*\b[\s\S]{0,40}?\bmode\s*:\s*["']?(?:execute|preview)\b/i;

function stripSchemaLeak(text: string): string {
  const match = SCHEMA_LEAK_MARKER.exec(text);
  if (!match) return text;
  return text.slice(0, match.index).trim();
}

function finalizeReply(text: string): string {
  const stripped = stripSchemaLeak(text).trim();
  return stripped || "Got it — I'll follow up on this.";
}

/** Never show raw JSON in chat — extract reply or return a safe fallback. */
export function sanitizeReplyForChat(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Got it.";

  const looksLikeJson =
    trimmed.startsWith("{") ||
    trimmed.startsWith("```") ||
    (trimmed.includes('"reply"') && trimmed.includes('"effects"'));

  if (!looksLikeJson) {
    const cleaned = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    return finalizeReply(cleaned);
  }

  const parsed = parseModelResponseText(trimmed);
  if (parsed?.reply) return finalizeReply(parsed.reply);

  const replyMatch = trimmed.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (replyMatch?.[1]) {
    try {
      return finalizeReply(JSON.parse(`"${replyMatch[1]}"`));
    } catch {
      return finalizeReply(replyMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'));
    }
  }

  return "On it — I'll follow up shortly.";
}

export function inferOutputTokenCap(userMessage: string, baseCap: number): number {
  const len = userMessage.trim().length;
  if (len <= 20) return Math.min(baseCap, 350);
  if (len <= 80) return Math.min(baseCap, 700);
  if (len <= 200) return Math.min(baseCap, 1200);
  return baseCap;
}

export function inferTemperature(userMessage: string): number {
  const len = userMessage.trim().length;
  if (len <= 40) return 0.35;
  if (len <= 120) return 0.42;
  return 0.48;
}
