import type { AIEmployee } from "@/lib/types";
import { MAYA_EMPLOYEE_NAME } from "./maya";

export type MayaWorkforceIntent =
  | "explain_adehq"
  | "review_workforce"
  | "improve_employee"
  | "hire_employee"
  | "create_room"
  | "organize_workspace"
  | "answer_question"
  | "unknown_help"
  | "small_talk";

const REVIEW_PATTERNS = [
  /\breview (my |the )?(ai )?workforce\b/i,
  /\bworkforce review\b/i,
  /\bsuggest improvements?\b/i,
  /\bwho (do i|should i) have\b/i,
  /\brole coverage\b/i,
  /\bwhat(?:'s| is) missing\b/i,
];

const IMPROVE_PATTERNS = [
  /\bimprove (an |an existing |my )?(ai )?employee\b/i,
  /\btune (an |my )?employee\b/i,
  /\brefine (an |my )?(ai )?employee\b/i,
  /\bupdate (instructions|personality|tools|approval)\b/i,
  /\bhelp me (improve|fix|update) (priya|alex|an employee)/i,
];

const HIRE_PATTERNS = [
  /\bhire (a|an|the)\b/i,
  /\bneed (a|an) .*(analyst|engineer|manager|assistant|specialist|rep|developer|designer)/i,
  /\blooking for (a|an)\b/i,
  /\brecruit(ing|ment)?\b/i,
  /\bnew (ai )?employee\b/i,
  /\bhelp me hire\b/i,
];

const CREATE_ROOM_PATTERNS = [
  /\bcreate (a |new )?room\b/i,
  /\bnew (project )?room\b/i,
  /\bset up (a |my )?room\b/i,
  /\borganize (a |my )?room\b/i,
];

const ORGANIZE_PATTERNS = [
  /\borganize (my |the )?workspace\b/i,
  /\brestructure\b/i,
  /\bclean up (my |the )?(workspace|rooms)\b/i,
];

const EXPLAIN_PATTERNS = [
  /how (does|do|is|are|can).*(adehq|workforce|workspace|this (app|platform)|things work)/i,
  /what (is|are|does|can).*(adehq|workforce|maya|this platform)/i,
  /explain.*(workforce|adehq|workspace|how (this|things) work)/i,
  /\bwalk me through\b/i,
  /\bhow adehq works\b/i,
  /\bwhat should i do first\b/i,
  /\bwhat should i do next\b/i,
  /\bwhat can (you|maya|adehq) do\b/i,
  /\btell me (about|what) adehq\b/i,
];

const SMALL_TALK_PATTERNS = [
  /^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|cool|great)[\s!.?]*$/i,
];

export function classifyMayaWorkforceIntent(text: string): MayaWorkforceIntent {
  const trimmed = text.trim();
  if (!trimmed) return "unknown_help";
  if (SMALL_TALK_PATTERNS.some((p) => p.test(trimmed))) return "small_talk";
  if (HIRE_PATTERNS.some((p) => p.test(trimmed))) return "hire_employee";
  if (IMPROVE_PATTERNS.some((p) => p.test(trimmed))) return "improve_employee";
  if (REVIEW_PATTERNS.some((p) => p.test(trimmed))) return "review_workforce";
  if (CREATE_ROOM_PATTERNS.some((p) => p.test(trimmed))) return "create_room";
  if (ORGANIZE_PATTERNS.some((p) => p.test(trimmed))) return "organize_workspace";
  if (EXPLAIN_PATTERNS.some((p) => p.test(trimmed))) return "explain_adehq";
  return "answer_question";
}

function nonMayaEmployees(employees: AIEmployee[]): AIEmployee[] {
  return employees.filter((e) => e.id !== "emp-maya" && !e.name.toLowerCase().includes("maya"));
}

export function buildMayaIntentReply(
  intent: MayaWorkforceIntent,
  text: string,
  ctx: {
    firstName?: string;
    employees: AIEmployee[];
    roomNames?: string[];
  },
): string {
  const first = ctx.firstName ?? "there";
  const roster = nonMayaEmployees(ctx.employees);

  switch (intent) {
    case "explain_adehq":
      return `AdeHQ is where your team and AI employees work together in one place.

**Rooms** are shared spaces — create one for each project or team area. **Topics** inside rooms (and DMs) keep conversations focused. **Direct messages** let you talk 1:1 with any AI employee, including me.

Your **Workforce** page is the roster — open any employee to tune their role, tools, memory, and approval rules. **Tasks**, **Memory**, and **Approvals** tie back to the room or topic where the work happened.

A good first step: pick a room, @mention an employee for help, or tell me who you'd like to hire. What would you like to set up first?`;

    case "review_workforce": {
      if (roster.length === 0) {
        return `You don't have any AI employees yet, ${first}. That's a clean slate — I'd start with one strong hire tied to your most urgent job.

Common first roles: Market Research Analyst, Sales Development Rep, or Software Engineer. Tell me what work you need done and I'll help you hire the right fit.`;
      }
      const lines = roster.map((e) => `• **${e.name}** — ${e.role}`);
      const roles = new Set(roster.map((e) => e.role.toLowerCase()));
      const gaps: string[] = [];
      if (![...roles].some((r) => /research|analyst/i.test(r))) {
        gaps.push("market research / competitive intel");
      }
      if (![...roles].some((r) => /sales|sdr|outreach/i.test(r))) {
        gaps.push("sales outreach / pipeline");
      }
      if (![...roles].some((r) => /engineer|developer/i.test(r))) {
        gaps.push("engineering / product build");
      }
      const gapText =
        gaps.length > 0
          ? `\n\n**Gaps I'd consider:** ${gaps.slice(0, 3).join(", ")}.`
          : "\n\nYou have solid role coverage for a small team.";
      const improve =
        roster.length >= 2
          ? "\n\n**Quick wins:** Review approval rules on high-autonomy roles, and make sure each employee has a clear primary room."
          : "\n\n**Next step:** Add a complementary hire or deepen this employee's brief and tools.";
      return `Here's a quick read on your workforce, ${first}:

**Current team (${roster.length}):**
${lines.join("\n")}${gapText}${improve}

Want me to help improve someone specific, or hire for a gap?`;
    }

    case "improve_employee": {
      if (roster.length === 0) {
        return `You don't have any AI employees to improve yet. Want to hire your first one? Tell me the role and I'll guide you through it.`;
      }
      const picker = roster
        .slice(0, 6)
        .map((e) => `• **${e.name}** — ${e.role}`)
        .join("\n");
      return `Happy to help sharpen an employee, ${first}. Which one should we focus on?

${picker}

Once you pick someone, tell me what to improve:
• role & responsibilities
• personality & tone
• tools & integrations
• approval rules
• memory & context
• output quality or response style`;
    }

    case "hire_employee":
      return `Got it — let's find the right hire. What role are you thinking about, or what job needs to get done? I can suggest a role if you're not sure yet.`;

    case "create_room":
      return `Let's set up a room. What's it for — a project, a client, a product area, or a team function?

A few presets that work well:
• **Product launch** — PM, research, and design employees
• **Sales pipeline** — SDR + research support
• **Engineering sprint** — engineer + PM in one space

Tell me the room name or purpose and I'll suggest who to add.`;

    case "organize_workspace":
      return `I can help tidy how your workspace is set up. A few levers:

• **One room per major workstream** — avoids context bleed
• **Topics for side threads** — hiring, research sprints, client work
• **Employee-to-room mapping** — each hire has a primary home

${ctx.roomNames?.length ? `You currently have ${ctx.roomNames.length} room(s): ${ctx.roomNames.slice(0, 4).join(", ")}${ctx.roomNames.length > 4 ? "…" : ""}.` : ""}

What feels messy right now — too many rooms, unclear ownership, or employees without a home?`;

    case "small_talk":
      return `Hey ${first} — I'm ${MAYA_EMPLOYEE_NAME}, your AI Workforce Manager. I can help you hire, review your team, improve employees, or explain how AdeHQ works. What do you need?`;

    case "answer_question":
    case "unknown_help":
    default: {
      const lower = text.toLowerCase();
      if (/task|approval|memory/.test(lower)) {
        return `**Tasks** track open work for humans and AI employees. **Approvals** gate sensitive actions before an employee proceeds. **Memory** stores facts your team wants to keep — scoped to a room, topic, or employee profile.

All of these connect back to the room or topic where the work happened. Want details on any one of these?`;
      }
      if (/room|topic/.test(lower)) {
        return `**Rooms** are shared workspaces. **Topics** split a room (or DM) into focused threads — "Direct Chat" is the main thread in DMs. Create a new topic when a conversation needs its own context (like a hiring session).

Want help creating a room or organizing topics?`;
      }
      return `I'm here to help with hiring, workforce reviews, employee improvements, and navigating AdeHQ. What would be most useful right now?`;
    }
  }
}
