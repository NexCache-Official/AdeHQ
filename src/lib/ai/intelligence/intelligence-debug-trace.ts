import type { IntelligenceContext, IntelligenceStep } from "./intelligence-context";

export type ConversationDebugTrace = {
  roomKind: "dm" | "room" | "unknown";
  employeeId?: string;
  employeeName?: string;
  triggerMessageId?: string;
  agentRunId?: string;
  workMode?: string;
  aiMode?: string;
  researchLevel?: number;
  intelligence?: ReturnType<typeof summarizeIntelligence>;
  dmSteward?: Record<string, unknown>;
  gatewaySearch?: Record<string, unknown>;
  timeline: DebugTimelineEntry[];
};

export type DebugTimelineEntry = {
  at: string;
  layer: string;
  decision: string;
  confidence?: number;
  durationMs?: number;
  detail?: string;
};

export function summarizeIntelligence(context: IntelligenceContext | undefined) {
  if (!context) return undefined;
  return {
    fastPath: context.fastPath,
    thinkingBudget: context.thinkingBudget,
    knowledge: context.knowledge
      ? {
          provider: context.knowledge.provider,
          found: context.knowledge.found,
          confidence: context.knowledge.confidence,
        }
      : undefined,
    cache: context.cache,
    router: context.router,
    researchLevel: context.researchLevel,
    search: context.search,
    composer: context.composer,
    backgroundLearning: context.backgroundLearning,
    steps: context.steps,
  };
}

export function stepsToTimeline(steps: IntelligenceStep[]): DebugTimelineEntry[] {
  const base = Date.now();
  return steps.map((step, index) => ({
    at: new Date(base + index).toISOString(),
    layer: step.layer,
    decision: step.decision,
    confidence: step.confidence,
    durationMs: step.durationMs,
    detail: step.metadata ? JSON.stringify(step.metadata).slice(0, 400) : undefined,
  }));
}

export function buildConversationDebugTrace(input: {
  roomKind: "dm" | "room" | "unknown";
  intelligence?: IntelligenceContext;
  dmSteward?: Record<string, unknown>;
  gatewaySearch?: Record<string, unknown>;
  employeeId?: string;
  employeeName?: string;
  triggerMessageId?: string;
  agentRunId?: string;
  aiMode?: string;
  extraTimeline?: DebugTimelineEntry[];
}): ConversationDebugTrace {
  const intelligence = input.intelligence;
  return {
    roomKind: input.roomKind,
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    triggerMessageId: input.triggerMessageId,
    agentRunId: input.agentRunId,
    workMode: intelligence?.workMode,
    aiMode: input.aiMode,
    researchLevel: intelligence?.researchLevel,
    intelligence: summarizeIntelligence(intelligence),
    dmSteward: input.dmSteward,
    gatewaySearch: input.gatewaySearch,
    timeline: [
      ...(intelligence ? stepsToTimeline(intelligence.steps) : []),
      ...(input.extraTimeline ?? []),
    ],
  };
}
