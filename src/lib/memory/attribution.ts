import type { AIEmployee, MemoryEntry, ProjectRoom, RoomTopic, WorkspaceMember } from "@/lib/types";
import type { MemoryScope } from "./categories";
import { normalizeMemoryScope } from "./scope-rules";

export type MemoryAttributionContext = {
  rooms: ProjectRoom[];
  topics: RoomTopic[];
  employees: AIEmployee[];
  workspaceMembers: WorkspaceMember[];
  currentUserId?: string;
  currentUserName?: string;
};

export function resolveActorName(
  id: string | undefined,
  type: "human" | "ai" | "system" | undefined,
  ctx: MemoryAttributionContext,
): string | null {
  if (!id) return null;
  if (type === "ai" || !type) {
    const emp = ctx.employees.find((e) => e.id === id);
    if (emp) return emp.name;
  }
  const member = ctx.workspaceMembers.find((m) => m.userId === id);
  if (member?.name) return member.name;
  if (id === ctx.currentUserId) return ctx.currentUserName ?? "You";
  if (type === "system") return "AdeHQ";
  return null;
}

export function memoryScopeLabel(
  entry: Pick<MemoryEntry, "scope" | "roomId" | "topicId" | "metadata">,
  ctx: MemoryAttributionContext,
): string {
  const room = ctx.rooms.find((r) => r.id === entry.roomId);
  const topic = entry.topicId ? ctx.topics.find((t) => t.id === entry.topicId) : undefined;
  const scope = normalizeMemoryScope(entry.scope ?? (entry.topicId ? "topic" : "room"));

  if (scope === "workspace") return "Workspace";
  if (scope === "employee_profile") return "Employee profile";
  if (scope === "employee_dm" || scope === "employee" || room?.kind === "dm") {
    const emp = ctx.employees.find(
      (e) => e.id === room?.dmEmployeeId || e.id === (entry.metadata?.dmEmployeeId as string | undefined),
    );
    return emp ? `${emp.name} DM` : "Employee DM";
  }
  if (topic) return `${room?.name ?? "Room"} · ${topic.title}`;
  return room?.name ?? "Room";
}

export function memorySourceLabel(
  entry: MemoryEntry,
  ctx: MemoryAttributionContext,
): string | null {
  if (entry.sourceType === "topic_summary") return "From topic summary";
  if (entry.sourceType === "hiring_session") return "From hiring session";
  if (entry.sourceType === "file") return "From file";
  if (entry.sourceType === "artifact") return "From artifact";
  if (entry.sourceMessageId) {
    const empName = resolveActorName(entry.sourceEmployeeId, "ai", ctx);
    if (empName) return `From ${empName.split(/\s+/)[0]}'s message`;
    return "From chat message";
  }
  if (entry.metadata?.sourceFileId) return "From uploaded file";
  return null;
}

export function memorySuggestedByLabel(entry: MemoryEntry, ctx: MemoryAttributionContext): string | null {
  const name = resolveActorName(entry.suggestedById, entry.suggestedByType, ctx);
  if (name) return name;
  if (entry.sourceType === "hiring_session" && entry.suggestedByType === "ai") {
    return "Maya";
  }
  if (entry.sourceType === "topic_summary" || entry.sourceType === "ai_suggestion") {
    return "Topic summary";
  }
  return null;
}

export function memorySavedByLabel(entry: MemoryEntry, ctx: MemoryAttributionContext): string {
  return (
    resolveActorName(entry.savedByUserId ?? entry.createdById, "human", ctx) ??
    "Teammate"
  );
}

export function scopeFilterMatches(entry: MemoryEntry, filter: MemoryScope | "dm" | "all"): boolean {
  if (filter === "all") return true;
  const scope = normalizeMemoryScope(entry.scope);
  if (filter === "dm") {
    return scope === "employee_dm" || scope === "employee";
  }
  if (filter === "employee") {
    return scope === "employee_dm" || scope === "employee_profile" || scope === "employee";
  }
  return scope === filter;
}
