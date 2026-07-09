import type {
  IntelligenceContext,
  IntelligenceLayer,
  IntelligenceStep,
} from "./intelligence-context";

export function appendIntelligenceStep(
  context: IntelligenceContext,
  step: IntelligenceStep,
): IntelligenceContext {
  return { ...context, steps: [...context.steps, step] };
}

export async function withIntelligenceStep<T>(
  context: IntelligenceContext,
  layer: IntelligenceLayer,
  operation: () => Promise<{
    value: T;
    decision: string;
    confidence?: number;
    metadata?: Record<string, unknown>;
  }>,
): Promise<{ context: IntelligenceContext; value: T }> {
  const startedAt = Date.now();
  const result = await operation();
  return {
    value: result.value,
    context: appendIntelligenceStep(context, {
      layer,
      decision: result.decision,
      confidence: result.confidence,
      durationMs: Date.now() - startedAt,
      metadata: result.metadata,
    }),
  };
}

export function intelligenceMetadata(context: IntelligenceContext) {
  return {
    version: "v1",
    workMode: context.workMode,
    selectedEmployeeId: context.selectedEmployeeId,
    steward: context.steward,
    fastPath: context.fastPath,
    thinkingBudget: context.thinkingBudget,
    knowledge: context.knowledge
      ? {
          provider: context.knowledge.provider,
          found: context.knowledge.found,
          confidence: context.knowledge.confidence,
          sourceCount: context.knowledge.sources.length,
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
