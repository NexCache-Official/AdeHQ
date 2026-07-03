import { isGeneralTopic, mainChatLabel } from "@/lib/topics";
import type { AIEmployee, MemoryScope, ProjectRoom, RoomTopic } from "@/lib/types";

export type MemoryScopeContext = {
  room: ProjectRoom;
  topic?: RoomTopic;
  employees: AIEmployee[];
  isDm?: boolean;
  isMayaHiring?: boolean;
};

export type MemoryScopeOption = {
  value: MemoryScope;
  label: string;
  description?: string;
};

/** Normalize legacy `employee` scope to employee_dm. */
export function normalizeMemoryScope(scope?: string | null): MemoryScope {
  if (!scope) return "topic";
  if (scope === "employee") return "employee_dm";
  if (
    scope === "workspace" ||
    scope === "room" ||
    scope === "topic" ||
    scope === "employee_dm" ||
    scope === "employee_profile"
  ) {
    return scope;
  }
  return "topic";
}

export function dmEmployeeForRoom(room: ProjectRoom, employees: AIEmployee[]): AIEmployee | undefined {
  const id = room.dmEmployeeId ?? room.aiEmployees[0];
  return employees.find((e) => e.id === id);
}

/** Default scope when saving memory from the current context. */
export function defaultMemoryScope(ctx: MemoryScopeContext): MemoryScope {
  if (ctx.isMayaHiring) return "workspace";
  if (ctx.isDm || ctx.room.kind === "dm") return "employee_dm";
  if (ctx.topic && !isGeneralTopic(ctx.topic)) return "topic";
  if (ctx.topic && isGeneralTopic(ctx.topic)) return "room";
  return "room";
}

export function memoryScopeOptions(ctx: MemoryScopeContext): MemoryScopeOption[] {
  const dmEmployee = dmEmployeeForRoom(ctx.room, ctx.employees);
  const generalLabel = ctx.topic && isGeneralTopic(ctx.topic)
    ? mainChatLabel(Boolean(ctx.isDm))
    : "General Chat";
  const topicLabel = ctx.topic && !isGeneralTopic(ctx.topic) ? ctx.topic.title : generalLabel;

  const options: MemoryScopeOption[] = [];

  if (ctx.isDm && dmEmployee) {
    options.push({
      value: "employee_dm",
      label: `${dmEmployee.name} DM`,
      description: "Private to this employee conversation",
    });
  }

  if (!ctx.isDm) {
    options.push({
      value: "room",
      label: ctx.room.name,
      description: "Shared across this room",
    });
    options.push({
      value: "topic",
      label: topicLabel,
      description: "Scoped to this topic or chat",
    });
  }

  options.push({
    value: "workspace",
    label: "Workspace",
    description: "Available workspace-wide to AI employees",
  });

  if (ctx.isMayaHiring) {
    options.unshift({
      value: "employee_profile",
      label: "Employee profile",
      description: "Attached to a hiring candidate profile",
    });
  }

  const seen = new Set<MemoryScope>();
  return options.filter((o) => {
    if (seen.has(o.value)) return false;
    seen.add(o.value);
    return true;
  });
}

export function memoryScopeSaveLabel(
  scope: MemoryScope,
  ctx: MemoryScopeContext,
): string {
  const normalized = normalizeMemoryScope(scope);
  const dmEmployee = dmEmployeeForRoom(ctx.room, ctx.employees);

  switch (normalized) {
    case "employee_dm":
      return dmEmployee ? `Save to ${dmEmployee.name} DM memory` : "Save to DM memory";
    case "employee_profile":
      return "Save to employee profile";
    case "workspace":
      return "Save to workspace memory";
    case "room":
      return `Save to ${ctx.room.name} memory`;
    case "topic": {
      const label =
        ctx.topic && !isGeneralTopic(ctx.topic)
          ? ctx.topic.title
          : mainChatLabel(Boolean(ctx.isDm));
      return `Save to ${label} memory`;
    }
    default:
      return "Save to memory";
  }
}

export function scopeUsesTopicId(scope: MemoryScope): boolean {
  return normalizeMemoryScope(scope) === "topic";
}
