import {
  EmployeeResponse,
  EmployeeResponseEffect,
  EmployeeRoleKey,
  SendMessageInput,
} from "../types";

// ===========================================================================
// AdeHQ — mock AI employee engine
// ---------------------------------------------------------------------------
// Deterministic, role-aware scripted responses. This is the single seam where
// real model providers can be swapped in later: replace the body of
// `sendMessageToEmployee` with a fetch to /api/employee and keep the same I/O.
// ===========================================================================

function emptyEffect(): EmployeeResponseEffect {
  return { workLog: [], tasks: [], memory: [], approvals: [] };
}

function has(text: string, ...words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w));
}

type Generator = (input: SendMessageInput) => {
  reply: string;
  effect: EmployeeResponseEffect;
};

// ---------------------------------------------------------------------------
// Role generators
// ---------------------------------------------------------------------------

const research: Generator = (input) => {
  const { room, message } = input;
  const effect = emptyEffect();
  const topic = message.replace(/@[\w\s]+employee/gi, "").trim() || "the brief";

  effect.statusChange = "working";
  effect.currentTask = "Running competitor & market research";
  effect.workLog.push(
    { action: "Read project brief", summary: `Read the ${room.name} brief to ground the research.`, status: "success", relatedEntityType: "message" },
    { action: "Searched the web", summary: `Searched competitor categories and recent launches.`, toolUsed: "Web Search", status: "success" },
    { action: "Compared options", summary: "Compared 5 categories against the wedge.", toolUsed: "Perplexity", status: "success" },
  );

  effect.memory.push({
    type: "research",
    title: `Research findings: ${truncate(topic, 48)}`,
    content:
      "Compared 5 categories. The clearest gap is a fast AI-native layer for solo devs. Direct browser-only generators feel like toys; Unity tooling is heavy. Recommend a focused wedge rather than a broad platform.",
    status: "draft",
  });
  effect.workLog.push({
    action: "Saved research memory",
    summary: "Wrote competitor findings to project memory.",
    toolUsed: "Files",
    status: "success",
    relatedEntityType: "memory",
  });

  const reply =
    `I'll take this. I'm comparing the landscape now — looking at direct competitors, adjacent tools, and where the obvious gaps are.\n\n` +
    `I found 5 categories worth tracking and the clearest wedge looks like a focused, AI-native angle rather than a broad platform play. I've saved the findings to project memory. ` +
    `Want me to hand this to PM Employee to turn it into a roadmap?`;

  return { reply, effect };
};

const pm: Generator = (input) => {
  const { room } = input;
  const effect = emptyEffect();
  effect.statusChange = "waiting_approval";
  effect.currentTask = "Turning research into a roadmap";

  effect.workLog.push(
    { action: "Read research findings", summary: "Read the latest research from project memory.", toolUsed: "Files", status: "success", relatedEntityType: "memory" },
    { action: "Drafted positioning", summary: "Wrote a sharp positioning recommendation.", status: "success" },
  );

  const taskTitles = [
    "Define ICP",
    "Build the smallest playable demo",
    "Write the landing page",
    "Create a comparison page",
    "Record a demo video",
    "Invite 10 design partners",
    "Collect feedback",
  ];
  for (const title of taskTitles) {
    effect.tasks.push({ title, status: "open", priority: title.includes("demo") || title.includes("ICP") ? "high" : "medium", assigneeType: "ai", createdFrom: "PM roadmap" });
  }
  effect.workLog.push({ action: "Created launch tasks", summary: `Created ${taskTitles.length} launch tasks.`, toolUsed: "Linear", status: "success", relatedEntityType: "task" });

  effect.approvals.push({
    title: `Approve PM Employee's launch roadmap`,
    description: `Pin the ${taskTitles.length}-task roadmap and positioning to ${room.name} memory.`,
    risk: "medium",
    actionType: "memory_pin",
  });
  effect.workLog.push({ action: "Requested approval", summary: "Requested approval to pin the launch roadmap.", status: "needs_approval", relatedEntityType: "approval" });

  effect.memory.push({
    type: "decision",
    title: "Launch positioning recommendation",
    content:
      "Recommend a focused, AI-native positioning aimed at the sharpest wedge audience — not a broad platform. Ship one delightful demo first, then expand.",
    status: "draft",
  });

  const reply =
    `On it. I read the research and turned it into a plan.\n\n` +
    `I created ${taskTitles.length} launch tasks and recommend a sharp, AI-native positioning aimed at the clearest wedge — not a broad platform. ` +
    `I've requested your approval to pin the roadmap to project memory.`;

  return { reply, effect };
};

const engineering: Generator = (input) => {
  const { message } = input;
  const effect = emptyEffect();
  effect.statusChange = "working";
  effect.currentTask = "Breaking the feature into implementation tasks";

  effect.workLog.push(
    { action: "Reviewed architecture", summary: "Reviewed the current architecture and data model.", toolUsed: "GitHub", status: "success" },
    { action: "Proposed a plan", summary: "Proposed a thin-client, server-aggregated approach.", status: "success" },
  );

  effect.tasks.push(
    { title: "Define data model", status: "open", priority: "high", assigneeType: "ai", createdFrom: "Engineering breakdown" },
    { title: "Build API + aggregation layer", status: "open", priority: "high", assigneeType: "ai", createdFrom: "Engineering breakdown" },
    { title: "Wire up the UI", status: "open", priority: "medium", assigneeType: "ai", createdFrom: "Engineering breakdown" },
  );
  effect.workLog.push({ action: "Created engineering tasks", summary: "Created 3 implementation tasks.", toolUsed: "Linear", status: "success", relatedEntityType: "task" });

  let reply =
    `Here's how I'd break this down: keep the client thin, do the heavy lifting server-side, and ship the smallest correct slice first.\n\n` +
    `I created 3 implementation tasks: data model, API + aggregation, and the UI.`;

  if (has(message, "github", "deploy", "push", "pr", "repo", "code", "write")) {
    effect.approvals.push({
      title: "Allow Engineering Employee to access GitHub (write)",
      description: "Engineering Employee needs write access to open PRs for this work.",
      risk: "high",
      actionType: "tool_access",
    });
    effect.workLog.push({ action: "Requested tool access", summary: "Requested GitHub write access.", toolUsed: "GitHub", status: "needs_approval", relatedEntityType: "approval" });
    effect.statusChange = "waiting_approval";
    reply += ` I'll need approval for GitHub write access before I can open PRs.`;
  }

  return { reply, effect };
};

const design: Generator = (input) => {
  const effect = emptyEffect();
  effect.statusChange = "working";
  effect.currentTask = "Reviewing UX and flows";

  effect.workLog.push(
    { action: "Reviewed the flow", summary: "Walked the flow from the user's point of view.", toolUsed: "Browser", status: "success" },
    { action: "Wrote design notes", summary: "Saved UX critique and suggestions to memory.", status: "success", relatedEntityType: "memory" },
  );
  effect.memory.push({
    type: "preference",
    title: "Design notes & UX critique",
    content:
      "Keep the surface calm and confident: strong hierarchy, generous spacing, one primary action per screen. Use presence and motion sparingly so it feels premium, not busy.",
    status: "draft",
  });

  const reply =
    `I went through this from the user's point of view. A few things stand out:\n\n` +
    `• Lead with one clear primary action per screen.\n` +
    `• Tighten the hierarchy — the eye should know where to go first.\n` +
    `• Use motion and presence sparingly so it feels premium.\n\n` +
    `I saved these as design notes in project memory.`;

  return { reply, effect };
};

const marketing: Generator = (input) => {
  const { message } = input;
  const effect = emptyEffect();
  effect.statusChange = "working";
  effect.currentTask = "Drafting launch plan & copy";

  effect.workLog.push(
    { action: "Drafted positioning copy", summary: "Drafted the launch headline and value props.", toolUsed: "Notion", status: "success" },
    { action: "Outlined distribution", summary: "Outlined a distribution plan across 4 channels.", status: "success" },
  );
  effect.tasks.push(
    { title: "Write landing page copy", status: "open", priority: "high", assigneeType: "ai", createdFrom: "Marketing plan" },
    { title: "Draft launch thread", status: "open", priority: "medium", assigneeType: "ai", createdFrom: "Marketing plan" },
  );
  effect.workLog.push({ action: "Created marketing tasks", summary: "Created 2 marketing tasks.", toolUsed: "Linear", status: "success", relatedEntityType: "task" });

  let reply =
    `Here's the launch angle: lead with the wedge audience, make the value obvious in one line, and pair it with a short demo.\n\n` +
    `I drafted landing copy and outlined a distribution plan across community, social, newsletter, and a launch thread.`;

  if (has(message, "send", "email", "announce", "blast", "waitlist", "newsletter")) {
    effect.approvals.push({
      title: "Marketing Employee wants approval before sending launch email",
      description: "Send the launch announcement to the waitlist.",
      risk: "high",
      actionType: "external_action",
    });
    effect.workLog.push({ action: "Requested approval", summary: "Requested approval to send the launch email.", status: "needs_approval", relatedEntityType: "approval" });
    effect.statusChange = "waiting_approval";
    reply += ` I drafted the launch email too — I'll need your approval before sending anything externally.`;
  }

  return { reply, effect };
};

const gamedev: Generator = (input) => {
  const effect = emptyEffect();
  effect.statusChange = "working";
  effect.currentTask = "Scoping the prototype";

  effect.workLog.push(
    { action: "Scoped prototype", summary: "Scoped the smallest fun, shippable prototype.", toolUsed: "Godot", status: "success" },
    { action: "Wrote gameplay notes", summary: "Saved the core loop and architecture to memory.", status: "success", relatedEntityType: "memory" },
  );
  effect.tasks.push(
    { title: "Build core gameplay loop", status: "open", priority: "high", assigneeType: "ai", createdFrom: "Game dev plan" },
    { title: "Add juice (sfx, particles, feedback)", status: "open", priority: "medium", assigneeType: "ai", createdFrom: "Game dev plan" },
    { title: "Playtest with 5 people", status: "open", priority: "medium", assigneeType: "ai", createdFrom: "Game dev plan" },
  );
  effect.workLog.push({ action: "Created game dev tasks", summary: "Created 3 prototype tasks.", toolUsed: "Linear", status: "success", relatedEntityType: "task" });
  effect.memory.push({
    type: "architecture",
    title: "Prototype core loop & architecture",
    content:
      "Start with the smallest fun loop, build in Godot, keep scenes modular. Prioritize game feel (juice) over scope. Ship something playable before adding features.",
    status: "draft",
  });

  const reply =
    `Love it. I'd scope the smallest fun thing we can ship, then add juice.\n\n` +
    `Core loop first, then sfx/particles/feedback, then a quick playtest. I created 3 tasks in Godot and saved the architecture to memory.`;

  return { reply, effect };
};

const generic: Generator = (input) => {
  const { employee, room } = input;
  const effect = emptyEffect();
  effect.statusChange = "working";
  effect.currentTask = `Working on a request in ${room.name}`;
  effect.workLog.push(
    { action: "Read the request", summary: "Read the message and the room context.", status: "success" },
    { action: "Drafted a plan", summary: "Drafted next steps and owners.", status: "success" },
  );
  effect.tasks.push({ title: `Follow up: ${employee.role}`, status: "open", priority: "medium", assigneeType: "ai", createdFrom: "Conversation" });

  const reply =
    `On it. I've read the context and drafted a clear plan with next steps. I created a task to track it and I'll flag anything I need approval for before acting externally.`;
  return { reply, effect };
};

const GENERATORS: Record<EmployeeRoleKey, Generator> = {
  research,
  pm,
  engineering,
  design,
  marketing,
  gamedev,
  operations: generic,
  sales: generic,
  support: generic,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function sendMessageToEmployee(
  input: SendMessageInput,
): Promise<EmployeeResponse> {
  // Simulate provider latency; UI shows a typing indicator in the meantime.
  await new Promise((r) => setTimeout(r, 30));

  const gen = GENERATORS[input.employee.roleKey] ?? generic;
  const { reply, effect } = gen(input);

  // Respect permissions: strip effects the employee isn't allowed to produce.
  const perms = input.employee.permissions;
  if (!perms.createTasks) effect.tasks = [];
  if (!perms.writeDraftMemory) effect.memory = [];
  if (!perms.requestApproval) effect.approvals = [];

  return {
    employeeId: input.employee.id,
    employeeName: input.employee.name,
    reply,
    effect,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
