import {
  AIEmployee,
  Approval,
  Call,
  DemoState,
  EmployeePermissions,
  EmployeeRoleKey,
  MemoryEntry,
  ProjectRoom,
  RoomMessage,
  RoomTopic,
  Task,
  TopicMember,
  Tool,
  ToolAccess,
  WorkLogEvent,
} from "@/lib/types";

export const DEMO_VERSION = 3;

// ---------------------------------------------------------------------------
// Tool catalog
// ---------------------------------------------------------------------------

export const TOOL_CATALOG: Tool[] = [
  { id: "web-search", name: "Web Search", category: "Research", description: "Search the live web for fresh information and sources.", status: "mock" },
  { id: "browser", name: "Browser", category: "Research", description: "Open and read web pages like a human researcher.", status: "mock" },
  { id: "perplexity", name: "Perplexity", category: "Research", description: "Answer engine for deep, cited research.", status: "mock" },
  { id: "files", name: "Files", category: "Storage", description: "Read and write project files and documents.", status: "mock" },
  { id: "google-drive", name: "Google Drive", category: "Storage", description: "Access shared docs, sheets, and folders.", status: "not_connected" },
  { id: "github", name: "GitHub", category: "Coding", description: "Read repos, open PRs, and manage issues.", status: "mock" },
  { id: "cursor", name: "Cursor", category: "Coding", description: "Pair-program inside the codebase.", status: "mock" },
  { id: "vercel", name: "Vercel", category: "Coding", description: "Deploy previews and inspect production.", status: "mock" },
  { id: "supabase", name: "Supabase", category: "Coding", description: "Query the database and manage schema.", status: "mock" },
  { id: "figma", name: "Figma", category: "Design", description: "Read design files and leave critique.", status: "not_connected" },
  { id: "notion", name: "Notion", category: "Productivity", description: "Read and write docs, specs, and wikis.", status: "mock" },
  { id: "linear", name: "Linear", category: "Productivity", description: "Create and track issues and cycles.", status: "mock" },
  { id: "slack", name: "Slack", category: "Communication", description: "Post updates and read channels.", status: "not_connected" },
  { id: "discord", name: "Discord", category: "Communication", description: "Engage your community server.", status: "not_connected" },
  { id: "gmail", name: "Gmail", category: "Communication", description: "Draft and send email (with approval).", status: "not_connected" },
  { id: "calendar", name: "Calendar", category: "Productivity", description: "Schedule meetings and standups.", status: "not_connected" },
  { id: "unity", name: "Unity", category: "Game development", description: "Inspect Unity scenes and assets.", status: "not_connected" },
  { id: "godot", name: "Godot", category: "Game development", description: "Work with Godot scenes and scripts.", status: "mock" },
  { id: "blender", name: "Blender", category: "Game development", description: "Generate and tweak 3D assets.", status: "not_connected" },
  { id: "stripe", name: "Stripe", category: "Business", description: "Inspect payments and revenue (with approval).", status: "not_connected" },
  { id: "siliconflow", name: "SiliconFlow", category: "Model providers", description: "DeepSeek, Qwen, Kimi, and more.", status: "mock" },
  { id: "anthropic", name: "Anthropic", category: "Model providers", description: "Claude models for reasoning and writing.", status: "mock" },
  { id: "gemini", name: "Gemini", category: "Model providers", description: "Google multimodal models.", status: "mock" },
];

function tool(
  id: string,
  permission: ToolAccess["permission"],
  status: ToolAccess["status"] = "mock",
  lastUsedAt?: string,
): ToolAccess {
  const meta = TOOL_CATALOG.find((t) => t.id === id)!;
  return {
    toolId: id,
    name: meta.name,
    category: meta.category,
    status,
    permission,
    lastUsedAt,
  };
}

// ---------------------------------------------------------------------------
// Permission presets
// ---------------------------------------------------------------------------

export function defaultPermissions(
  overrides: Partial<EmployeePermissions> = {},
): EmployeePermissions {
  return {
    readMemory: true,
    writeDraftMemory: true,
    pinMemory: false,
    createTasks: true,
    assignTasks: false,
    messageEmployees: true,
    startCalls: false,
    requestApproval: true,
    approvalBeforeExternal: true,
    approvalBeforeEmails: true,
    approvalBeforeCode: true,
    approvalBeforeBilling: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Role template metadata (used by hire + onboarding flows)
// ---------------------------------------------------------------------------

export type RoleTemplate = {
  key: EmployeeRoleKey;
  role: string;
  name: string;
  blurb: string;
  description: string;
  suggestedTools: string[];
  suggestedProvider: string;
  suggestedModel: string;
  difficulty: "Easy" | "Standard" | "Advanced";
  accent: string;
  communicationStyle: string;
  successCriteria: string;
  instructions: string;
};

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "research",
    role: "Senior Market Researcher",
    name: "Research Employee",
    blurb: "Market research, competitor analysis, summaries, and reports.",
    description:
      "Helps with market research, competitor research, summaries, and reports. Digs through the web, compares options, and writes crisp findings into project memory.",
    suggestedTools: ["web-search", "perplexity", "browser", "files"],
    suggestedProvider: "Anthropic",
    suggestedModel: "Claude",
    difficulty: "Easy",
    accent: "#22d3ee",
    communicationStyle: "Concise, source-driven, neutral.",
    successCriteria: "Findings are accurate, well-sourced, and decision-ready.",
    instructions:
      "Always read the project brief first. Compare at least 3–5 options. Save key findings to project memory. Suggest a PM handoff when research turns into a plan.",
  },
  {
    key: "pm",
    role: "Product Manager",
    name: "PM Employee",
    blurb: "Turns ideas into specs, tasks, roadmaps, and acceptance criteria.",
    description:
      "Turns ideas into specs, tasks, roadmaps, and acceptance criteria. Reads research, makes a recommendation, and breaks work into shippable tasks.",
    suggestedTools: ["notion", "linear", "files", "web-search"],
    suggestedProvider: "SiliconFlow",
    suggestedModel: "GPT",
    difficulty: "Standard",
    accent: "#ea580c",
    communicationStyle: "Decisive, structured, outcome-oriented.",
    successCriteria: "Plans are clear, prioritized, and ready to execute.",
    instructions:
      "Read related research before planning. Recommend a sharp positioning. Create concrete tasks with owners. Request approval for major roadmaps.",
  },
  {
    key: "engineering",
    role: "Full-stack Engineer",
    name: "Engineering Employee",
    blurb: "Code, architecture, GitHub, Cursor, Vercel, and Supabase.",
    description:
      "Helps with code, architecture, GitHub, Cursor, Vercel, and Supabase. Breaks features into implementation tasks and flags what needs access.",
    suggestedTools: ["github", "cursor", "vercel", "supabase", "files"],
    suggestedProvider: "SiliconFlow",
    suggestedModel: "GPT / Cursor",
    difficulty: "Advanced",
    accent: "#5b8cff",
    communicationStyle: "Pragmatic, precise, risk-aware.",
    successCriteria: "Architecture is sound and work is broken down cleanly.",
    instructions:
      "Propose a simple architecture first. Break features into tasks. Request approval before write access to GitHub or changing code.",
  },
  {
    key: "design",
    role: "Product Designer",
    name: "Design Employee",
    blurb: "Product flows, UI critique, Figma, and design systems.",
    description:
      "Helps with product flows, UI critiques, Figma, and design systems. Reviews UX, proposes improvements, and documents design decisions.",
    suggestedTools: ["figma", "browser", "files"],
    suggestedProvider: "Gemini",
    suggestedModel: "Gemini",
    difficulty: "Standard",
    accent: "#f472b6",
    communicationStyle: "Thoughtful, user-centered, specific.",
    successCriteria: "UX is clear, consistent, and delightful.",
    instructions:
      "Critique flows from the user's point of view. Suggest concrete UI improvements. Save design notes to memory.",
  },
  {
    key: "marketing",
    role: "Growth Marketer",
    name: "Marketing Employee",
    blurb: "Launch plans, landing copy, social posts, and distribution.",
    description:
      "Creates launch plans, landing page copy, social posts, and distribution strategy. Drafts external messaging and requests approval before sending.",
    suggestedTools: ["web-search", "notion", "browser"],
    suggestedProvider: "SiliconFlow",
    suggestedModel: "GPT",
    difficulty: "Standard",
    accent: "#34d399",
    communicationStyle: "Punchy, persuasive, audience-aware.",
    successCriteria: "Messaging is sharp and the launch plan is actionable.",
    instructions:
      "Lead with the wedge audience. Draft copy and a distribution plan. Request approval before sending any external message or email.",
  },
  {
    key: "gamedev",
    role: "Game Development Assistant",
    name: "Game Dev Employee",
    blurb: "Unity/Godot tasks, gameplay ideas, assets, and mechanics.",
    description:
      "Helps with Unity/Godot tasks, gameplay ideas, assets, and mechanics. Plans prototypes and writes architecture and gameplay notes.",
    suggestedTools: ["unity", "godot", "github", "blender", "files"],
    suggestedProvider: "Anthropic",
    suggestedModel: "Claude / GPT",
    difficulty: "Advanced",
    accent: "#fbbf24",
    communicationStyle: "Hands-on, gameplay-first, scrappy.",
    successCriteria: "Prototypes are scoped tightly and feel fun.",
    instructions:
      "Scope the smallest fun prototype. Break gameplay into tasks. Save architecture and gameplay notes to memory.",
  },
  {
    key: "operations",
    role: "Operations Lead",
    name: "Operations Employee",
    blurb: "Process, scheduling, vendor coordination, and logistics.",
    description:
      "Keeps the company running: process, scheduling, vendor coordination, and logistics. Turns chaos into checklists.",
    suggestedTools: ["calendar", "notion", "files"],
    suggestedProvider: "SiliconFlow",
    suggestedModel: "GPT",
    difficulty: "Easy",
    accent: "#94a3b8",
    communicationStyle: "Organized, calm, reliable.",
    successCriteria: "Operations run on time with no dropped balls.",
    instructions:
      "Turn requests into clear checklists. Track owners and dates. Flag blockers early.",
  },
  {
    key: "sales",
    role: "Sales Representative",
    name: "Sales Employee",
    blurb: "Outreach, pipeline, demos, and follow-ups.",
    description:
      "Drives revenue: outreach, pipeline management, demos, and follow-ups. Drafts outreach and requests approval before sending.",
    suggestedTools: ["gmail", "calendar", "notion"],
    suggestedProvider: "SiliconFlow",
    suggestedModel: "GPT",
    difficulty: "Standard",
    accent: "#fb923c",
    communicationStyle: "Warm, direct, persistent.",
    successCriteria: "Pipeline grows and follow-ups never slip.",
    instructions:
      "Qualify leads, draft outreach, and track follow-ups. Request approval before sending any email.",
  },
  {
    key: "support",
    role: "Customer Support",
    name: "Support Employee",
    blurb: "Answers questions, triages issues, and keeps users happy.",
    description:
      "Front line for users: answers questions, triages issues, and escalates bugs. Writes help docs and keeps a calm tone.",
    suggestedTools: ["slack", "notion", "files"],
    suggestedProvider: "Anthropic",
    suggestedModel: "Claude",
    difficulty: "Easy",
    accent: "#2dd4bf",
    communicationStyle: "Friendly, patient, clear.",
    successCriteria: "Users feel heard and issues get resolved fast.",
    instructions:
      "Answer with empathy. Triage and escalate real bugs. Save recurring issues to memory.",
  },
];

export function roleTemplate(key: EmployeeRoleKey): RoleTemplate {
  return ROLE_TEMPLATES.find((r) => r.key === key)!;
}

// ---------------------------------------------------------------------------
// Seed builders
// ---------------------------------------------------------------------------

const t = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

function buildEmployees(): AIEmployee[] {
  return [
    {
      id: "emp-research",
      name: "Research Employee",
      role: "Senior Market Researcher",
      roleKey: "research",
      provider: "siliconflow",
      model: "",
      modelMode: "long_context",
      seniority: "Senior",
      status: "working",
      currentTask: "Researching AI game engine competitors",
      instructions: roleTemplate("research").instructions,
      communicationStyle: roleTemplate("research").communicationStyle,
      successCriteria: roleTemplate("research").successCriteria,
      tools: [
        tool("web-search", "write", "mock", t(8)),
        tool("perplexity", "write", "mock", t(12)),
        tool("browser", "read", "mock", t(20)),
        tool("files", "write", "mock", t(40)),
      ],
      permissions: defaultPermissions({ pinMemory: false }),
      memoryCount: 6,
      tasksCompleted: 4,
      messagesSent: 28,
      approvalsRequested: 2,
      avgResponseTime: "1.2s",
      trustScore: 92,
      accent: "#22d3ee",
      defaultRoomId: "room-forgefield",
      lastActiveAt: t(8),
      createdAt: t(60 * 24 * 9),
    },
    {
      id: "emp-pm",
      name: "PM Employee",
      role: "Product Manager",
      roleKey: "pm",
      provider: "siliconflow",
      model: "",
      modelMode: "balanced",
      seniority: "Lead",
      status: "waiting_approval",
      currentTask: "Turning research into a launch roadmap",
      instructions: roleTemplate("pm").instructions,
      communicationStyle: roleTemplate("pm").communicationStyle,
      successCriteria: roleTemplate("pm").successCriteria,
      tools: [
        tool("notion", "write", "mock", t(15)),
        tool("linear", "write", "mock", t(18)),
        tool("files", "read", "mock", t(45)),
        tool("web-search", "read", "mock", t(120)),
      ],
      permissions: defaultPermissions({ assignTasks: true, pinMemory: true }),
      memoryCount: 5,
      tasksCompleted: 7,
      messagesSent: 41,
      approvalsRequested: 3,
      avgResponseTime: "1.6s",
      trustScore: 88,
      accent: "#ea580c",
      defaultRoomId: "room-forgefield",
      lastActiveAt: t(15),
      createdAt: t(60 * 24 * 9),
    },
    {
      id: "emp-eng",
      name: "Engineering Employee",
      role: "Full-stack Engineer",
      roleKey: "engineering",
      provider: "siliconflow",
      model: "",
      modelMode: "coding",
      seniority: "Senior",
      status: "idle",
      currentTask: "Reviewing app architecture",
      instructions: roleTemplate("engineering").instructions,
      communicationStyle: roleTemplate("engineering").communicationStyle,
      successCriteria: roleTemplate("engineering").successCriteria,
      tools: [
        tool("github", "read", "mock", t(90)),
        tool("cursor", "write", "mock", t(95)),
        tool("vercel", "read", "mock", t(200)),
        tool("supabase", "read", "mock", t(220)),
        tool("files", "write", "mock", t(60)),
      ],
      permissions: defaultPermissions(),
      memoryCount: 3,
      tasksCompleted: 5,
      messagesSent: 19,
      approvalsRequested: 1,
      avgResponseTime: "2.1s",
      trustScore: 85,
      accent: "#5b8cff",
      defaultRoomId: "room-mvp",
      lastActiveAt: t(90),
      createdAt: t(60 * 24 * 8),
    },
    {
      id: "emp-design",
      name: "Design Employee",
      role: "Product Designer",
      roleKey: "design",
      provider: "siliconflow",
      model: "",
      modelMode: "balanced",
      seniority: "Senior",
      status: "on_call",
      currentTask: "Reviewing workspace UX",
      instructions: roleTemplate("design").instructions,
      communicationStyle: roleTemplate("design").communicationStyle,
      successCriteria: roleTemplate("design").successCriteria,
      tools: [
        tool("figma", "read", "not_connected"),
        tool("browser", "read", "mock", t(30)),
        tool("files", "read", "mock", t(70)),
      ],
      permissions: defaultPermissions(),
      memoryCount: 2,
      tasksCompleted: 3,
      messagesSent: 14,
      approvalsRequested: 1,
      avgResponseTime: "1.8s",
      trustScore: 90,
      accent: "#f472b6",
      defaultRoomId: "room-mvp",
      lastActiveAt: t(3),
      createdAt: t(60 * 24 * 7),
    },
    {
      id: "emp-marketing",
      name: "Marketing Employee",
      role: "Growth Marketer",
      roleKey: "marketing",
      provider: "siliconflow",
      model: "",
      modelMode: "balanced",
      seniority: "Mid",
      status: "idle",
      currentTask: "Drafting launch copy",
      instructions: roleTemplate("marketing").instructions,
      communicationStyle: roleTemplate("marketing").communicationStyle,
      successCriteria: roleTemplate("marketing").successCriteria,
      tools: [
        tool("web-search", "read", "mock", t(180)),
        tool("notion", "write", "mock", t(50)),
        tool("browser", "read", "mock", t(150)),
      ],
      permissions: defaultPermissions(),
      memoryCount: 2,
      tasksCompleted: 2,
      messagesSent: 11,
      approvalsRequested: 2,
      avgResponseTime: "1.5s",
      trustScore: 83,
      accent: "#34d399",
      defaultRoomId: "room-forgefield",
      lastActiveAt: t(140),
      createdAt: t(60 * 24 * 6),
    },
    {
      id: "emp-gamedev",
      name: "Game Dev Employee",
      role: "Game Development Assistant",
      roleKey: "gamedev",
      provider: "siliconflow",
      model: "",
      modelMode: "coding",
      seniority: "Senior",
      status: "working",
      currentTask: "Planning the Plinko prototype",
      instructions: roleTemplate("gamedev").instructions,
      communicationStyle: roleTemplate("gamedev").communicationStyle,
      successCriteria: roleTemplate("gamedev").successCriteria,
      tools: [
        tool("godot", "write", "mock", t(25)),
        tool("unity", "read", "not_connected"),
        tool("blender", "read", "not_connected"),
        tool("github", "read", "mock", t(110)),
        tool("files", "write", "mock", t(35)),
      ],
      permissions: defaultPermissions(),
      memoryCount: 4,
      tasksCompleted: 3,
      messagesSent: 16,
      approvalsRequested: 1,
      avgResponseTime: "1.9s",
      trustScore: 87,
      accent: "#fbbf24",
      defaultRoomId: "room-forgefield",
      lastActiveAt: t(25),
      createdAt: t(60 * 24 * 5),
    },
  ];
}

function buildRooms(): ProjectRoom[] {
  const forgefieldMessages: RoomMessage[] = [
    {
      id: "msg-1",
      roomId: "room-forgefield",
      senderType: "system",
      senderId: "system",
      senderName: "AdeHQ",
      content:
        "Room created. Forgefield Engine Launch — let's build an AI-native game engine launch.",
      createdAt: t(60 * 6),
    },
    {
      id: "msg-2",
      roomId: "room-forgefield",
      senderType: "human",
      senderId: "user-shubham",
      senderName: "Shubham",
      content:
        "@Research Employee research competitors for an AI-native game engine.",
      mentions: ["emp-research"],
      createdAt: t(60 * 5 + 50),
    },
    {
      id: "msg-3",
      roomId: "room-forgefield",
      senderType: "ai",
      senderId: "emp-research",
      senderName: "Research Employee",
      content:
        "I'll take this. I'm going to compare Godot forks, AI game builders, Unity tooling, and browser-based game generators, then save the findings to project memory.",
      createdAt: t(60 * 5 + 48),
      artifacts: [
        { type: "work_log", id: "wl-1", label: "Read project brief" },
        { type: "memory", id: "mem-2", label: "Saved competitor findings" },
      ],
    },
    {
      id: "msg-4",
      roomId: "room-forgefield",
      senderType: "ai",
      senderId: "emp-research",
      senderName: "Research Employee",
      content:
        "I found 5 competitor categories: Godot forks, AI-assisted editors, browser game generators, Unity asset pipelines, and AI playtest tools. The clearest gap is a fast AI layer on top of Godot. Saved to project memory — want me to hand this to PM Employee for a roadmap?",
      createdAt: t(60 * 5 + 44),
    },
    {
      id: "msg-5",
      roomId: "room-forgefield",
      senderType: "human",
      senderId: "user-shubham",
      senderName: "Shubham",
      content: "@PM Employee turn that into a launch roadmap.",
      mentions: ["emp-pm"],
      createdAt: t(60 * 5 + 40),
    },
    {
      id: "msg-6",
      roomId: "room-forgefield",
      senderType: "ai",
      senderId: "emp-pm",
      senderName: "PM Employee",
      content:
        "I read the competitor research and created 7 launch tasks. I recommend positioning Forgefield as an AI-native Godot distribution, not a browser toy generator. I've requested approval to pin the launch roadmap to project memory.",
      createdAt: t(60 * 5 + 36),
      artifacts: [
        { type: "task", id: "task-1", label: "7 launch tasks created" },
        { type: "approval", id: "appr-2", label: "Approval: pin launch roadmap" },
      ],
    },
  ];

  return [
    {
      id: "room-forgefield",
      name: "Forgefield Engine Launch",
      kind: "room",
      description: "Launch an AI-native game engine for indie developers.",
      brief:
        "Forgefield is an AI-native layer on top of Godot for solo and indie game developers. Goal: ship a launch wedge with a playable Plinko demo, a sharp landing page, and 10 design-partner devs. Avoid becoming a Unity/Unreal clone or a browser-only toy generator.",
      humans: ["user-shubham"],
      aiEmployees: ["emp-research", "emp-pm", "emp-gamedev", "emp-marketing", "emp-design"],
      messages: forgefieldMessages,
      tasks: ["task-1", "task-2", "task-3", "task-4", "task-5"],
      memory: ["mem-1", "mem-2", "mem-3"],
      unread: 2,
      accent: "#ea580c",
      createdAt: t(60 * 6),
      updatedAt: t(60 * 5 + 36),
    },
    {
      id: "room-stripe",
      name: "Stripe Analytics Dashboard",
      kind: "room",
      description: "Build a revenue analytics dashboard on top of Stripe.",
      brief:
        "Internal analytics dashboard reading Stripe data via Supabase. Goal: MRR, churn, and cohort views with clean charts. Engineering-led, design-reviewed.",
      humans: ["user-shubham"],
      aiEmployees: ["emp-eng", "emp-design"],
      messages: [
        {
          id: "msg-s1",
          roomId: "room-stripe",
          senderType: "system",
          senderId: "system",
          senderName: "AdeHQ",
          content: "Room created. Stripe Analytics Dashboard.",
          createdAt: t(60 * 30),
        },
        {
          id: "msg-s2",
          roomId: "room-stripe",
          senderType: "ai",
          senderId: "emp-eng",
          senderName: "Engineering Employee",
          content:
            "I reviewed the schema. I'd model events in Supabase and aggregate MRR server-side. I can break this into implementation tasks when you're ready.",
          createdAt: t(60 * 4),
        },
      ],
      tasks: ["task-6", "task-7"],
      memory: ["mem-4"],
      unread: 0,
      accent: "#5b8cff",
      createdAt: t(60 * 30),
      updatedAt: t(60 * 4),
    },
    {
      id: "room-mvp",
      name: "AdeHQ MVP Build",
      kind: "room",
      description: "Build the AdeHQ workspace MVP itself.",
      brief:
        "Build the AdeHQ demo MVP: a futuristic workspace where humans and AI employees collaborate. Self-serve onboarding for founders and freelancers. Keep it calm, premium, and magical.",
      humans: ["user-shubham"],
      aiEmployees: ["emp-eng", "emp-design", "emp-pm"],
      messages: [
        {
          id: "msg-m1",
          roomId: "room-mvp",
          senderType: "system",
          senderId: "system",
          senderName: "AdeHQ",
          content: "Room created. AdeHQ MVP Build.",
          createdAt: t(60 * 48),
        },
        {
          id: "msg-m2",
          roomId: "room-mvp",
          senderType: "ai",
          senderId: "emp-design",
          senderName: "Design Employee",
          content:
            "I reviewed the workspace UX. The room view should feel like a calm command center — I saved a few design notes to memory.",
          createdAt: t(60 * 2),
        },
      ],
      tasks: ["task-8"],
      memory: ["mem-5"],
      unread: 0,
      accent: "#34d399",
      createdAt: t(60 * 48),
      updatedAt: t(60 * 2),
    },
  ];
}

function buildTasks(): Task[] {
  return [
    { id: "task-1", roomId: "room-forgefield", title: "Define ICP (solo indie Godot devs)", description: "Lock the ideal customer profile for the launch wedge.", status: "in_progress", priority: "high", assigneeType: "ai", assigneeId: "emp-pm", createdFrom: "PM Employee roadmap", createdAt: t(60 * 5), updatedAt: t(60 * 2), dueDate: t(-60 * 24 * 3) },
    { id: "task-2", roomId: "room-forgefield", title: "Build Plinko prototype", description: "Smallest fun playable demo in Godot.", status: "in_progress", priority: "high", assigneeType: "ai", assigneeId: "emp-gamedev", createdFrom: "PM Employee roadmap", createdAt: t(60 * 5), updatedAt: t(60 * 1), dueDate: t(-60 * 24 * 5) },
    { id: "task-3", roomId: "room-forgefield", title: "Write Forgefield landing page", description: "Sharp positioning: AI-native Godot distribution.", status: "open", priority: "medium", assigneeType: "ai", assigneeId: "emp-marketing", createdFrom: "PM Employee roadmap", createdAt: t(60 * 5), updatedAt: t(60 * 5) },
    { id: "task-4", roomId: "room-forgefield", title: "Create comparison page", description: "Forgefield vs Godot forks vs browser generators.", status: "open", priority: "low", assigneeType: "ai", assigneeId: "emp-marketing", createdAt: t(60 * 5), updatedAt: t(60 * 5) },
    { id: "task-5", roomId: "room-forgefield", title: "Invite 10 indie devs as design partners", status: "waiting_approval", priority: "medium", assigneeType: "human", assigneeId: "user-shubham", createdAt: t(60 * 5), updatedAt: t(60 * 4) },
    { id: "task-6", roomId: "room-stripe", title: "Review Supabase schema", description: "Model events and aggregate MRR.", status: "in_progress", priority: "high", assigneeType: "ai", assigneeId: "emp-eng", createdAt: t(60 * 5), updatedAt: t(60 * 3) },
    { id: "task-7", roomId: "room-stripe", title: "Connect GitHub (mock) integration", status: "waiting_approval", priority: "medium", assigneeType: "ai", assigneeId: "emp-eng", createdAt: t(60 * 5), updatedAt: t(60 * 4) },
    { id: "task-8", roomId: "room-mvp", title: "Prepare investor demo", description: "End-to-end walkthrough of the AdeHQ workspace.", status: "open", priority: "high", assigneeType: "human", assigneeId: "user-shubham", createdAt: t(60 * 10), updatedAt: t(60 * 10) },
  ];
}

function buildMemory(): MemoryEntry[] {
  return [
    { id: "mem-1", roomId: "room-forgefield", type: "decision", title: "Forgefield should launch as an AI-native Godot distribution", content: "Position Forgefield as a fast-moving AI layer on top of Godot rather than a Unity clone, Unreal competitor, or browser-only game generator.", status: "pinned", createdByType: "ai", createdById: "emp-pm", createdAt: t(60 * 5) },
    { id: "mem-2", roomId: "room-forgefield", type: "research", title: "5 competitor categories for AI-native game engines", content: "Godot forks, AI-assisted editors, browser game generators, Unity asset pipelines, and AI playtest tools. The clearest gap is a fast AI layer on top of Godot for solo devs.", status: "approved", createdByType: "ai", createdById: "emp-research", createdAt: t(60 * 5 + 44) },
    { id: "mem-3", roomId: "room-forgefield", type: "decision", title: "First playable prototype should be Plinko", content: "Start with the smallest fun, shippable demo. Plinko is simple to build, easy to show, and demonstrates the AI-native workflow end to end.", status: "approved", createdByType: "ai", createdById: "emp-gamedev", createdAt: t(60 * 4) },
    { id: "mem-4", roomId: "room-stripe", type: "architecture", title: "Aggregate MRR server-side in Supabase", content: "Model Stripe events in Supabase and compute MRR/churn server-side. Keep the client thin and chart-only.", status: "approved", createdByType: "ai", createdById: "emp-eng", createdAt: t(60 * 4) },
    { id: "mem-5", roomId: "room-mvp", type: "preference", title: "Users want AI employees, not complicated agent workflows", content: "Keep AdeHQ self-serve for founders and freelancers. AI employees should feel like real coworkers, not a workflow builder.", status: "pinned", createdByType: "ai", createdById: "emp-design", createdAt: t(60 * 2) },
  ];
}

function buildApprovals(): Approval[] {
  return [
    { id: "appr-1", roomId: "room-stripe", requestedBy: "emp-eng", title: "Allow Engineering Employee to access GitHub (write)", description: "Engineering Employee needs write access to open PRs for the analytics dashboard.", risk: "high", status: "pending", actionType: "tool_access", createdAt: t(60 * 4) },
    { id: "appr-2", roomId: "room-forgefield", requestedBy: "emp-pm", title: "Approve PM Employee's launch roadmap", description: "Pin the 7-task launch roadmap and positioning to project memory.", risk: "medium", status: "pending", actionType: "memory_pin", createdAt: t(60 * 5 + 36) },
    { id: "appr-3", roomId: "room-forgefield", requestedBy: "emp-research", title: "Pin Research Employee's competitor findings to project memory", description: "Pin the 5-category competitor analysis as a durable reference.", risk: "low", status: "pending", actionType: "memory_pin", createdAt: t(60 * 5 + 40) },
    { id: "appr-4", roomId: "room-forgefield", requestedBy: "emp-marketing", title: "Marketing Employee wants approval before sending launch email", description: "Send the Forgefield launch announcement to the waitlist (240 contacts).", risk: "high", status: "pending", actionType: "external_action", createdAt: t(60 * 3) },
  ];
}

function buildWorkLog(): WorkLogEvent[] {
  return [
    { id: "wl-1", roomId: "room-forgefield", employeeId: "emp-research", action: "Read project brief", summary: "Read the Forgefield Engine Launch brief to ground the research.", status: "success", relatedEntityType: "message", relatedEntityId: "msg-3", createdAt: t(60 * 5 + 49) },
    { id: "wl-2", roomId: "room-forgefield", employeeId: "emp-research", action: "Searched AI game engines", summary: "Searched the web for AI-native game engines and Godot forks.", toolUsed: "Web Search", status: "success", createdAt: t(60 * 5 + 47) },
    { id: "wl-3", roomId: "room-forgefield", employeeId: "emp-research", action: "Created competitor findings", summary: "Wrote 5 competitor categories to project memory.", toolUsed: "Files", status: "success", relatedEntityType: "memory", relatedEntityId: "mem-2", createdAt: t(60 * 5 + 45) },
    { id: "wl-4", roomId: "room-forgefield", employeeId: "emp-research", action: "Saved 3 memory entries", summary: "Saved competitor categories, gap analysis, and a recommendation.", status: "success", relatedEntityType: "memory", relatedEntityId: "mem-2", createdAt: t(60 * 5 + 44) },
    { id: "wl-5", roomId: "room-forgefield", employeeId: "emp-pm", action: "Read competitor findings", summary: "Read Research Employee's competitor analysis from memory.", toolUsed: "Files", status: "success", relatedEntityType: "memory", relatedEntityId: "mem-2", createdAt: t(60 * 5 + 38) },
    { id: "wl-6", roomId: "room-forgefield", employeeId: "emp-pm", action: "Created 7 launch tasks", summary: "Broke the launch into 7 prioritized tasks.", toolUsed: "Linear", status: "success", relatedEntityType: "task", relatedEntityId: "task-1", createdAt: t(60 * 5 + 37) },
    { id: "wl-7", roomId: "room-forgefield", employeeId: "emp-pm", action: "Requested approval for launch roadmap", summary: "Requested approval to pin the launch roadmap to project memory.", status: "needs_approval", relatedEntityType: "approval", relatedEntityId: "appr-2", createdAt: t(60 * 5 + 36) },
    { id: "wl-8", roomId: "room-mvp", employeeId: "emp-eng", action: "Reviewed architecture notes", summary: "Reviewed AdeHQ MVP architecture and state model.", toolUsed: "GitHub", status: "success", createdAt: t(60 * 2 + 30) },
    { id: "wl-9", roomId: "room-mvp", employeeId: "emp-design", action: "Requested Figma access", summary: "Requested Figma read access to review the design system.", toolUsed: "Figma", status: "needs_approval", createdAt: t(60 * 2 + 20) },
    { id: "wl-10", roomId: "room-forgefield", employeeId: "emp-marketing", action: "Drafted launch copy", summary: "Drafted the first version of the Forgefield landing headline.", toolUsed: "Notion", status: "success", createdAt: t(60 * 3 + 10) },
    { id: "wl-11", roomId: "room-forgefield", employeeId: "emp-gamedev", action: "Planned Plinko prototype", summary: "Scoped the smallest fun Plinko prototype in Godot.", toolUsed: "Godot", status: "success", relatedEntityType: "task", relatedEntityId: "task-2", createdAt: t(25) },
  ];
}

function buildCalls(): Call[] {
  return [
    {
      id: "call-1",
      roomId: "room-forgefield",
      title: "Forgefield Launch Standup",
      status: "ended",
      participants: [
        { id: "user-shubham", type: "human", name: "Shubham", accent: "#f97316", speaking: false },
        { id: "emp-research", type: "ai", name: "Research Employee", accent: "#22d3ee", speaking: false },
        { id: "emp-pm", type: "ai", name: "PM Employee", accent: "#ea580c", speaking: false },
        { id: "emp-eng", type: "ai", name: "Engineering Employee", accent: "#5b8cff", speaking: false },
      ],
      transcript: [
        { id: "tr-1", speakerId: "user-shubham", speakerName: "Shubham", text: "What should we build this week?", createdAt: t(60 * 12) },
        { id: "tr-2", speakerId: "emp-research", speakerName: "Research Employee", text: "The clearest wedge is indie devs building Godot prototypes.", createdAt: t(60 * 12 + 1) },
        { id: "tr-3", speakerId: "emp-pm", speakerName: "PM Employee", text: "I recommend a one-week sprint focused on the Plinko demo and landing page.", createdAt: t(60 * 12 + 2) },
        { id: "tr-4", speakerId: "emp-eng", speakerName: "Engineering Employee", text: "I can break this into implementation tasks.", createdAt: t(60 * 12 + 3) },
      ],
      actionItems: [
        "Finalize Plinko scope",
        "Build playable prototype",
        "Write launch page",
        "Create comparison memo",
        "Invite 10 testers",
      ],
      startedAt: t(60 * 12),
      endedAt: t(60 * 11),
    },
  ];
}

// ---------------------------------------------------------------------------
// Topics (demo)
// ---------------------------------------------------------------------------

function buildTopicsForDemo(
  rooms: ProjectRoom[],
  workspaceId: string,
  tasks: Task[],
  memory: MemoryEntry[],
  approvals: Approval[],
  workLog: WorkLogEvent[],
): { topics: RoomTopic[]; topicMembers: TopicMember[] } {
  const topics: RoomTopic[] = [];
  const topicMembers: TopicMember[] = [];
  const now = t(0);

  for (const room of rooms) {
    const topicId = `topic-general-${room.id}`;
    const roomTasks = tasks.filter((tk) => tk.roomId === room.id);
    const roomMemory = memory.filter((m) => m.roomId === room.id);
    const roomApprovals = approvals.filter((a) => a.roomId === room.id && a.status === "pending");
    const lastMsg = room.messages[room.messages.length - 1];

    topics.push({
      id: topicId,
      workspaceId,
      roomId: room.id,
      title: "General",
      description: "Default topic for existing room messages.",
      status: "active",
      priority: "normal",
      createdByType: "system",
      lastMessageAt: lastMsg?.createdAt ?? null,
      lastActivityAt: lastMsg?.createdAt ?? now,
      messageCount: room.messages.length,
      taskCount: roomTasks.length,
      openTaskCount: roomTasks.filter((tk) => tk.status !== "done").length,
      memoryCount: roomMemory.length,
      approvalCount: roomApprovals.length,
      agentRunCount: 0,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    });

    topicMembers.push({
      id: `tm-${room.id}-human`,
      workspaceId,
      roomId: room.id,
      topicId,
      memberType: "human",
      memberId: DEMO_USER.id,
      role: "owner",
      notificationLevel: "normal",
      createdAt: room.createdAt,
    });

    for (const empId of room.aiEmployees) {
      topicMembers.push({
        id: `tm-${room.id}-${empId}`,
        workspaceId,
        roomId: room.id,
        topicId,
        memberType: "ai",
        memberId: empId,
        role: "participant",
        notificationLevel: "normal",
        createdAt: room.createdAt,
      });
    }

    room.messages.forEach((m) => {
      m.topicId = topicId;
    });
    roomTasks.forEach((tk) => {
      tk.topicId = topicId;
    });
    roomMemory.forEach((m) => {
      m.topicId = topicId;
    });
    approvals.filter((a) => a.roomId === room.id).forEach((a) => {
      a.topicId = topicId;
    });
    workLog.filter((w) => w.roomId === room.id).forEach((w) => {
      w.topicId = topicId;
    });
  }

  return { topics, topicMembers };
}

// ---------------------------------------------------------------------------
// Full demo state
// ---------------------------------------------------------------------------

export const DEMO_USER = {
  id: "user-shubham",
  name: "Shubham Kumar",
  email: "shubham@adehq.com",
  role: "Founder",
};

export function buildDemoState(): DemoState {
  const rooms = buildRooms();
  const tasks = buildTasks();
  const memory = buildMemory();
  const approvals = buildApprovals();
  const workLog = buildWorkLog();
  const { topics, topicMembers } = buildTopicsForDemo(
    rooms,
    "ws-1",
    tasks,
    memory,
    approvals,
    workLog,
  );

  return {
    version: DEMO_VERSION,
    user: { ...DEMO_USER },
    workspace: { id: "ws-1", name: "AdeHQ Demo Workspace", plan: "Demo", workspaceMode: "demo" },
    workspaceMembers: [
      {
        workspaceId: "ws-1",
        userId: DEMO_USER.id,
        name: DEMO_USER.name,
        email: DEMO_USER.email,
        role: "owner",
        createdAt: t(60 * 24 * 10),
      },
    ],
    workspaceInvitations: [],
    onboardingComplete: true,
    employees: buildEmployees(),
    rooms,
    topics,
    topicMembers,
    tasks,
    memory,
    approvals,
    workLog,
    tools: TOOL_CATALOG.map((t) => ({ ...t })),
    calls: buildCalls(),
    settings: { mode: "mock", activeProvider: "mock" },
  };
}

/** Empty-ish state for a brand new signup (before onboarding). */
export function buildFreshState(
  user: DemoState["user"],
  workspaceName: string,
): DemoState {
  const full = buildDemoState();
  return {
    ...full,
    user,
    workspace: { ...full.workspace, name: workspaceName },
    onboardingComplete: false,
  };
}
