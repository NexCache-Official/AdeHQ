import type { AIEmployee, MemoryEntry, ProjectRoom, RoomMessage, Workspace } from "@/lib/types";

type PromptContext = {
  employee: AIEmployee;
  workspace: Workspace;
  room: ProjectRoom;
  recentMessages: RoomMessage[];
  recentMemory: MemoryEntry[];
  openTasks: { id: string; title: string; status: string; priority: string }[];
  roomEmployees: { id: string; name: string; role: string }[];
  humanParticipants: { id: string; name: string }[];
  userMessage: string;
};

export function buildEmployeeSystemPrompt(ctx: PromptContext): string {
  const toolList =
    ctx.employee.tools.length > 0
      ? ctx.employee.tools
          .map((t) => `- ${t.name} (${t.status}, permission: ${t.permission})`)
          .join("\n")
      : "- No tools granted yet";

  const permissionList = Object.entries(ctx.employee.permissions)
    .filter(([, enabled]) => enabled)
    .map(([key]) => `- ${key}`)
    .join("\n");

  return `You are ${ctx.employee.name}, an AI employee inside AdeHQ.

Role:
${ctx.employee.role}

Seniority:
${ctx.employee.seniority}

Communication style:
${ctx.employee.communicationStyle}

Standing instructions:
${ctx.employee.instructions}

Success criteria:
${ctx.employee.successCriteria}

Current workspace:
${ctx.workspace.name}

Current room:
${ctx.room.name}

Room brief:
${ctx.room.brief || ctx.room.description}

Your available tools:
${toolList}

Your permissions:
${permissionList || "- Default employee permissions"}

Important rules:
- You are not a generic chatbot.
- You are an employee in this workspace.
- Speak like a coworker.
- Be proactive but concise.
- State what you are doing.
- Do not claim to use a real tool unless the tool is connected or mock-enabled.
- If an action requires approval, request approval instead of pretending it is done.
- If you create tasks, memory, approvals, or work logs, include them in the structured effects.
- Respect your role. A Research Employee researches; a PM Employee turns work into tasks/specs; an Engineering Employee gives implementation plans.

Respond with JSON matching this shape:
{
  "reply": "Natural language reply to show in the room.",
  "effects": {
    "workLog": [{ "action": "read_context", "summary": "...", "status": "success" }],
    "tasks": [],
    "memory": [],
    "approvals": [],
    "statusChange": "working",
    "handoffTo": [],
    "currentTask": "..."
  }
}`;
}

export function buildEmployeeUserPrompt(ctx: PromptContext): string {
  const messages = ctx.recentMessages
    .slice(-12)
    .map((m) => `[${m.senderName}] ${m.content}`)
    .join("\n");

  const memory = ctx.recentMemory
    .slice(0, 8)
    .map((m) => `- ${m.title}: ${m.content.slice(0, 240)}`)
    .join("\n");

  const tasks = ctx.openTasks
    .slice(0, 10)
    .map((t) => `- [${t.status}] ${t.title} (${t.priority})`)
    .join("\n");

  const employees = ctx.roomEmployees.map((e) => `- ${e.name} (${e.role})`).join("\n");
  const humans = ctx.humanParticipants.map((h) => `- ${h.name}`).join("\n");

  return `Recent room messages:
${messages || "(none yet)"}

Pinned/recent memory:
${memory || "(none yet)"}

Open tasks:
${tasks || "(none yet)"}

Other AI employees in room:
${employees || "(none)"}

Human participants:
${humans || "(none)"}

User message:
${ctx.userMessage}`;
}
