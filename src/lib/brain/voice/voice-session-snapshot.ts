/**
 * PR-18.2A6 — Hot Voice Session Snapshot.
 * Built once at call connect; updated incrementally. Avoids full Supabase
 * hydration on every ordinary conversational turn.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmployeeVoiceProfile } from "./types";
import { loadEmployeeVoiceProfile } from "./voice-profile";

export type VoiceTurn = {
  speaker: "human" | "employee";
  text: string;
  at: string;
};

export type VoiceSessionSnapshot = {
  callId: string;
  workspaceId: string;
  roomId: string;
  topicId: string;
  humanUserId: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  employeePrompt: string;
  employeeVoiceProfile: EmployeeVoiceProfile;
  conversationSummary: string;
  recentTurns: VoiceTurn[];
  activeEntities: string[];
  relevantMemoryDigest: string;
  permissionsDigest: string;
  availableToolNames: string[];
  promptCacheKey?: string;
  /** One soft Work Hours warning spoken per call when capacity is low. */
  workHoursLowWarnedAt?: number | null;
  version: number;
  builtAt: number;
  lastUpdatedAt: number;
};

const MAX_RECENT_TURNS = 5;
const snapshots = new Map<string, VoiceSessionSnapshot>();

export function getVoiceSessionSnapshot(
  callId: string,
): VoiceSessionSnapshot | null {
  return snapshots.get(callId) ?? null;
}

export function setVoiceSessionSnapshot(
  snapshot: VoiceSessionSnapshot,
): VoiceSessionSnapshot {
  snapshots.set(snapshot.callId, snapshot);
  return snapshot;
}

export function clearVoiceSessionSnapshot(callId: string): void {
  snapshots.delete(callId);
}

export function markVoiceWorkHoursLowWarned(
  callId: string,
): VoiceSessionSnapshot | null {
  const current = snapshots.get(callId);
  if (!current) return null;
  const next: VoiceSessionSnapshot = {
    ...current,
    workHoursLowWarnedAt: Date.now(),
    version: current.version + 1,
    lastUpdatedAt: Date.now(),
  };
  snapshots.set(callId, next);
  return next;
}

function compactSummary(turns: VoiceTurn[]): string {
  if (turns.length === 0) return "Call just started.";
  const lines = turns.slice(-4).map((turn) => {
    const who = turn.speaker === "human" ? "Human" : "Employee";
    const text =
      turn.text.length > 140 ? `${turn.text.slice(0, 137).trim()}…` : turn.text;
    return `${who}: ${text}`;
  });
  return lines.join("\n");
}

function extractEntities(text: string): string[] {
  const matches = text.match(
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b|\b(?:CRM|Drive|Dubai|Canterbury|Shawarma)\b/g,
  );
  return Array.from(new Set(matches ?? [])).slice(0, 12);
}

export function appendVoiceSessionTurn(
  callId: string,
  turn: VoiceTurn,
): VoiceSessionSnapshot | null {
  const current = snapshots.get(callId);
  if (!current) return null;
  const recentTurns = [...current.recentTurns, turn].slice(-MAX_RECENT_TURNS);
  const entities = Array.from(
    new Set([
      ...current.activeEntities,
      ...extractEntities(turn.text),
    ]),
  ).slice(0, 16);
  const next: VoiceSessionSnapshot = {
    ...current,
    recentTurns,
    activeEntities: entities,
    conversationSummary: compactSummary(recentTurns),
    version: current.version + 1,
    lastUpdatedAt: Date.now(),
  };
  snapshots.set(callId, next);
  return next;
}

function buildEmployeePrompt(input: {
  name: string;
  role: string;
  communicationStyle?: string | null;
}): string {
  return [
    `You are ${input.name}, an AI employee inside AdeHQ.`,
    `Role: ${input.role}`,
    input.communicationStyle
      ? `Communication style: ${input.communicationStyle}`
      : "",
    "Voice response instructions:",
    "- You are on a live phone call. Sound human and direct.",
    "- Begin with the conclusion or direct response.",
    "- Do not begin with \"Sure\", \"Certainly\", or a restatement of the question.",
    "- Make the first clause independently speakable (5–12 words).",
    "- For denser answers, use short spoken beats (decision, then one reason, then offer more).",
    "- Light connectives like \"So —\" are fine; do not stall with empty hedges.",
    "- Default to 1–3 short sentences (~25–80 words).",
    "- No markdown, JSON, tool XML, or [TOOL_CALL] blocks.",
    "- No tools are available on this fast path. If tools/research are required, say you will check and keep it brief.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function buildVoiceSessionSnapshot(input: {
  client: SupabaseClient;
  callId: string;
  workspaceId: string;
  roomId: string;
  topicId: string;
  humanUserId: string;
  employeeId: string;
}): Promise<VoiceSessionSnapshot> {
  const [employeeResult, memoryResult, voiceProfile] = await Promise.all([
    input.client
      .from("ai_employees")
      .select("id, name, role, communication_style, tools")
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.employeeId)
      .maybeSingle(),
    input.client
      .from("memory_entries")
      .select("content, title")
      .eq("workspace_id", input.workspaceId)
      .eq("room_id", input.roomId)
      .order("updated_at", { ascending: false })
      .limit(4),
    loadEmployeeVoiceProfile(
      input.client,
      input.workspaceId,
      input.employeeId,
    ),
  ]);

  if (employeeResult.error) throw employeeResult.error;
  if (!employeeResult.data) {
    throw new Error("Employee not found for voice session snapshot.");
  }

  const employee = employeeResult.data;
  const toolNames = Array.isArray(employee.tools)
    ? employee.tools
        .map((tool) =>
          typeof tool === "string"
            ? tool
            : typeof tool === "object" && tool && "id" in tool
              ? String((tool as { id: unknown }).id)
              : "",
        )
        .filter(Boolean)
        .slice(0, 24)
    : [];

  const memoryDigest = (memoryResult.data ?? [])
    .map((row) => {
      const title = String(row.title ?? "").trim();
      const content = String(row.content ?? "").trim();
      const line = title ? `${title}: ${content}` : content;
      return line.length > 160 ? `${line.slice(0, 157).trim()}…` : line;
    })
    .filter(Boolean)
    .join("\n");

  const employeeName = String(employee.name);
  const employeeRole = String(employee.role);
  const employeePrompt = buildEmployeePrompt({
    name: employeeName,
    role: employeeRole,
    communicationStyle:
      typeof employee.communication_style === "string"
        ? employee.communication_style
        : null,
  });

  const snapshot: VoiceSessionSnapshot = {
    callId: input.callId,
    workspaceId: input.workspaceId,
    roomId: input.roomId,
    topicId: input.topicId,
    humanUserId: input.humanUserId,
    employeeId: input.employeeId,
    employeeName,
    employeeRole,
    employeePrompt,
    employeeVoiceProfile: voiceProfile,
    conversationSummary: "Call just started.",
    recentTurns: [],
    activeEntities: [],
    relevantMemoryDigest: memoryDigest,
    permissionsDigest:
      "Standard AdeHQ member permissions. Fast path cannot mutate CRM/Drive/email.",
    availableToolNames: toolNames,
    promptCacheKey: `voice:${input.employeeId}:v1`,
    workHoursLowWarnedAt: null,
    version: 1,
    builtAt: Date.now(),
    lastUpdatedAt: Date.now(),
  };
  snapshots.set(input.callId, snapshot);
  return snapshot;
}

export function compileVoiceFastPrompt(input: {
  snapshot: VoiceSessionSnapshot;
  userMessage: string;
}): { system: string; prompt: string; estimatedTokens: number } {
  const recent = input.snapshot.recentTurns
    .slice(-5)
    .map((turn) => {
      const who = turn.speaker === "human" ? "Human" : input.snapshot.employeeName;
      return `${who}: ${turn.text}`;
    })
    .join("\n");

  const system = [
    input.snapshot.employeePrompt,
    "",
    "Static call policy:",
    input.snapshot.permissionsDigest,
    input.snapshot.availableToolNames.length
      ? `Known tools (not callable here): ${input.snapshot.availableToolNames.slice(0, 12).join(", ")}`
      : "No tools on this path.",
  ].join("\n");

  const prompt = [
    `Call summary:\n${input.snapshot.conversationSummary}`,
    recent ? `Recent turns:\n${recent}` : "",
    input.snapshot.relevantMemoryDigest
      ? `Relevant memory:\n${input.snapshot.relevantMemoryDigest}`
      : "",
    input.snapshot.activeEntities.length
      ? `Active entities: ${input.snapshot.activeEntities.join(", ")}`
      : "",
    `Latest human message:\n${input.userMessage.trim()}`,
    "",
    "Reply as spoken prose only.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const estimatedTokens = Math.ceil((system.length + prompt.length) / 4);
  return { system, prompt, estimatedTokens };
}
