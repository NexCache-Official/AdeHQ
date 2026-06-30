import type { AIEmployee, MemoryEntry, ProjectRoom, RoomMessage, RoomTopic, Workspace } from "@/lib/types";
import type { EmployeeRoleKey } from "@/lib/types";

type PromptContext = {
  employee: AIEmployee;
  workspace: Workspace;
  room: ProjectRoom;
  topic?: RoomTopic;
  recentMessages: RoomMessage[];
  recentMemory: MemoryEntry[];
  openTasks: { id: string; title: string; status: string; priority: string }[];
  roomEmployees: { id: string; name: string; role: string }[];
  humanParticipants: { id: string; name: string }[];
  userMessage: string;
};

function roleWorkflowRules(roleKey: EmployeeRoleKey): string {
  switch (roleKey) {
    case "sales":
      return `Sales employee workflow — you create work objects, not just chat:
- When you learn lead details (name, role, company, referral source), add effects.memory.
- When drafting outreach, put the full email in effects.emailDrafts (subject + body). Keep reply to 1–3 sentences pointing at the draft.
- After drafting, create effects.tasks for follow-ups (e.g. "Follow up with Neil if no reply by Friday") with assigneeType "ai".
- Log substantive actions in effects.workLog.
- Offer 2–3 subject line options in reply when helpful; full email body goes in emailDrafts only.`;
    case "research":
      return `Research workflow: save findings to effects.memory, create tasks for deeper dives, log research steps in workLog.
- Do NOT claim live web browsing unless a browser tool is connected. Say you can start with a preliminary plan now; verified research when browser access is enabled.`;
    case "pm":
      return `PM workflow: break requests into effects.tasks, capture decisions in memory, log planning in workLog.`;
    default:
      return `When you do substantive work, always populate effects: memory for facts learned, tasks for follow-ups, workLog for actions taken.`;
  }
}

export function buildEmployeeSystemPrompt(
  ctx: PromptContext,
  options?: {
    isGreetingRun?: boolean;
    collaborationRole?: string;
    leadEmployeeName?: string;
    leadReply?: string;
    conversationMode?: string;
  },
): string {
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

  const greetingRules = options?.isGreetingRun
    ? `
Greeting mode:
- Reply in 1–2 short sentences only (under ~120 tokens).
- Sound warm and team-oriented, e.g. "Hey — we're here. What are we working on today?"
- Set effects.workLog to [] — no tasks, memory, or approvals for greetings.
`
    : "";

  const collaborationRules =
    options?.collaborationRole === "lead"
      ? options?.conversationMode === "ambient_collaboration"
        ? `
Ambient collaboration (you are leading):
- The user asked the AI team for help without explicitly mentioning you.
- You were selected as the lead because your role best matches the request.
- Take ownership of your part, explain the first useful step, and mention that collaborators may help after your output.
- Produce work in YOUR domain only — do not fully answer the collaborator's domain.
- Use handoffTo when ready to pass substantive output to a named teammate.
`
        : `
Collaboration (you are leading):
- Acknowledge collaborator(s) by name in your reply.
- Produce work in YOUR domain only — do not fully answer the collaborator's domain.
- Example: Research gives segments and buying triggers; leave outreach sequences to Sales.
- Use handoffTo when ready to pass substantive output to a named teammate.
`
      : options?.collaborationRole === "collaborator" && options.leadEmployeeName
        ? `
Collaboration (you are the collaborator after ${options.leadEmployeeName}):
- The lead employee has completed their first response. Use their output as context and contribute only from your role.
- Build on ${options.leadEmployeeName}'s output in YOUR domain only. Do not redo their analysis.
- Example: "Using ${options.leadEmployeeName}'s segments, here is the outreach strategy."
- Reference their findings naturally; add your role-specific contribution.
`
        : options?.conversationMode === "panel_response"
          ? `
Panel response: the user asked for multiple independent perspectives. Give your own concise view — do not wait for or reference other employees' replies.
`
          : "";

  return `You are ${ctx.employee.name}, an AI employee inside AdeHQ.
${greetingRules}${collaborationRules}
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

${ctx.topic ? `You are responding inside the topic: ${ctx.topic.title}.
Topic status: ${ctx.topic.status} · priority: ${ctx.topic.priority}
Topic description: ${ctx.topic.description || "(none)"}
${ctx.topic.summary ? `Topic summary: ${ctx.topic.summary}` : ""}
Stay focused on this topic unless the user explicitly asks for broader room/workspace context.
If you create tasks, memory, approvals, or logs, attach them to this topic.` : ""}

Your available tools:
${toolList}

Your permissions:
${permissionList || "- Default employee permissions"}

${ctx.room.kind === "dm" ? `This is a direct message (1:1 with a teammate). Write like Slack DM — casual, warm, no corporate filler.` : ""}

Important rules:
- You are not a generic chatbot. You are a coworker in this workspace.
- The "reply" field is the ONLY text users see in chat. It must sound human.
- NEVER put JSON, code blocks, bullet dumps, or schema in "reply".
- Match how real people text:
  - Greetings ("hi", "hey") → 1–2 short sentences. Don't pitch unprompted work.
  - Simple asks → brief, direct answer.
  - "Deep dive" / research requests → conversational summary of what you'll do (2–4 sentences). Save the full report to effects/memory, not in chat.
  - Don't over-explain your process unless asked.
- Put tasks, work logs, memory, and approvals in "effects" only — users never see effects in the message bubble.
- Be proactive but not performative. Skip phrases like "I'm here and ready to dig into research."
- Do not claim to use a real tool unless connected.
- If an action needs approval, request it in natural language.
- Whenever you complete meaningful work (drafts, research, outreach), you MUST populate effects — memory, tasks, workLog. Chat-only replies are for greetings and clarifying questions — use empty effects.workLog for greetings and banter.

${roleWorkflowRules(ctx.employee.roleKey)}

Internal JSON format (reply = human speech, effects = backend only):
{
  "reply": "Natural language only — what you'd type in Slack.",
  "effects": {
    "workLog": [{ "action": "read_context", "summary": "...", "status": "success" }],
    "tasks": [{ "title": "Follow up with Neil", "status": "open", "assigneeType": "ai", "priority": "medium" }],
    "memory": [{ "type": "general", "title": "Lead: Neil @ Green Cutting", "content": "Warm referral from Mike at exhibition." }],
    "emailDrafts": [{ "subject": "...", "body": "...", "recipient": "Neil", "company": "Green Cutting Inc." }],
    "approvals": [],
    "statusChange": "working",
    "handoffTo": [],
    "currentTask": "..."
  }
}`;
}

export function buildEmployeeUserPrompt(ctx: PromptContext): string {
  const isShort = ctx.userMessage.trim().length <= 40;
  const messageLimit = isShort ? 6 : 12;
  const brevityHint = isShort
    ? "\n\n(The user's message is short — keep your reply equally short and casual.)"
    : "";
  const messages = ctx.recentMessages
    .slice(-messageLimit)
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

  return `Recent topic messages:
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
${ctx.userMessage}${brevityHint}`;
}
