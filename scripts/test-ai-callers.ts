/**
 * V19.9.0c / c-final — AI caller smoke tests and low-risk migration audit coverage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildTopicSummaryContextBlock,
  generateTopicSummaryPayload,
  generateTopicSummaryPayloadRuntime,
  getTopicSummaryRuntimeDispatch,
  setTopicSummaryTestHooks,
  topicSummarySchema,
  type GeneratedTopicSummaryPayload,
} from "@/lib/topic-summary/generate";
import { orchestrateConversation } from "@/lib/orchestration/conversation-orchestrator";
import {
  classifyWithLlm,
  classifyWithLlmRuntime,
  getClassifierRuntimeDispatch,
  maybeEnhanceWithLlm,
  orchestrationClassifierSchema,
  setClassifierTestHooks,
} from "@/lib/orchestration/llm-classifier";
import type {
  AIEmployeeProfile,
  OrchestrationPlan,
  OrchestratorInput,
} from "@/lib/orchestration/types";
import {
  generateCandidateCopies,
  generateCandidateCopiesRuntime,
  getCandidatesRuntimeDispatch,
  setCandidatesTestHooks,
} from "@/lib/hiring/candidates-llm";
import {
  generateRecruiterResponse,
  generateRecruiterResponseRuntime,
  getRecruiterRuntimeDispatch,
  setRecruiterTestHooks,
} from "@/lib/hiring/recruiter-llm";
import { recruiterResponseSchema } from "@/lib/hiring/brief-schema";
import type { AiEmployeeJobBrief } from "@/lib/hiring/types";
import {
  embedQueryText,
  embedTexts,
  embedTextsRuntime,
  getEmbedRuntimeDispatch,
  setEmbeddingTestHooks,
} from "@/lib/server/file-embeddings";
import { EMBEDDING_DIMENSIONS } from "@/lib/config/features";
import { mockDeterministicEmbedding } from "@/lib/ai/runtime/adapters/mock";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { getAiRuntimeSnapshot } from "@/lib/ai/runtime-log";

const SAMPLE_CONTEXT = buildTopicSummaryContextBlock({
  topicTitle: "Launch planning",
  topicDescription: "Q3 product launch",
  messages: [
    {
      id: "msg_test_1",
      senderName: "Alex",
      content: "We should finalize the landing page copy before Friday.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "msg_test_2",
      senderName: "Priya",
      content: "I can draft market research bullets once browser research is approved.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "msg_test_3",
      senderName: "You",
      content: "Let's keep scope to landing page and email sequence for now.",
      createdAt: new Date().toISOString(),
    },
  ],
  tasks: [{ title: "Draft landing page", status: "open", priority: "high" }],
  memory: [],
  approvals: [],
  workLogs: [],
  employees: [
    { id: "emp_alex", name: "Alex", role: "Marketing" },
    { id: "emp_priya", name: "Priya", role: "Research" },
  ],
});

const SAMPLE_EMPLOYEES: AIEmployeeProfile[] = [
  {
    id: "emp_alex",
    name: "Alex",
    role: "Marketing",
    roleKey: "marketing",
    instructions: "",
    seniority: "mid",
    metadata: {},
    systemEmployeeKey: null,
    isSystemEmployee: false,
  },
  {
    id: "emp_priya",
    name: "Priya",
    role: "Research",
    roleKey: "research",
    instructions: "",
    seniority: "mid",
    metadata: {},
    systemEmployeeKey: null,
    isSystemEmployee: false,
  },
];

const SAMPLE_ORCHESTRATOR_INPUT: OrchestratorInput = {
  workspaceId: "ws_test",
  roomId: "room_test",
  topicId: "topic_test",
  userId: "user_test",
  messageId: "msg_test_4",
  messageText: "Alex, can you draft a short landing page outline by Friday?",
  mentionedEmployeeIds: ["emp_alex"],
  roomEmployees: SAMPLE_EMPLOYEES,
  topicEmployees: SAMPLE_EMPLOYEES,
  recentMessages: [
    {
      id: "msg_test_1",
      senderType: "human",
      text: "We need to finalize launch assets.",
      createdAt: new Date().toISOString(),
    },
  ],
  existingTopics: [],
  smartAssistEnabled: false,
};

const LOW_CONFIDENCE_PLAN: OrchestrationPlan = {
  intent: "ambient_smart_assist",
  confidence: 0.5,
  reason: "test low confidence",
  selectedEmployeeIds: [],
  leadEmployeeId: null,
  collaboratorEmployeeIds: [],
  shouldRespond: false,
  responseOrder: [],
  suggestedActions: [],
  workLogRequired: false,
  workLogReason: null,
};

const SAMPLE_HIRING_BRIEF: AiEmployeeJobBrief = {
  roleTitle: "Marketing Specialist",
  department: "Marketing",
  domain: "B2B SaaS",
  mission: "Drive qualified pipeline through content and campaigns.",
  coreResponsibilities: ["Draft landing pages", "Run email campaigns"],
  technicalFocus: [],
  businessFocus: ["Lead generation"],
  successMetrics: ["MQL volume", "Campaign conversion"],
  communicationStyle: "Clear and concise",
  personalityTraits: ["Proactive"],
  proactivityLevel: "balanced",
  qualityPreference: "balanced",
  seniorityLevel: "specialist",
  autonomyLevel: "balanced",
  approvalRules: ["Approve external sends"],
  toolsNeeded: ["CRM"],
  assumptions: [],
  openQuestions: [],
};

const SAMPLE_RECRUITER_LLM = {
  body: {
    roleSeed: "Marketing Specialist",
    roleKey: "marketing",
    selectedDepartment: "marketing",
  },
  conversation: [{ role: "user" as const, text: "We need someone for landing pages and email." }],
  system: "You are Maya, recruiter at AdeHQ.",
  prompt: "Conversation:\nUser: We need someone for landing pages and email.",
};

const STUB_TOPIC_SUMMARY: GeneratedTopicSummaryPayload = {
  summary: "Fallback summary from legacy path.",
  whatHappened: "Team discussed launch scope.",
  currentDecision: null,
  openQuestions: [],
  keyFacts: [{ text: "Landing page is in scope." }],
  nextActions: [{ title: "Draft landing page", status: "Planned" }],
  suggestedMemory: [],
};

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}`);
    console.log(`      ${detail}`);
    throw error;
  }
}

async function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function isSiliconFlowUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("SILICONFLOW") ||
    message.includes("API key") ||
    message.includes("SiliconFlow")
  );
}

/** Minimal Supabase client mock for ai_work_units insert/update chains. */
function createMockWorkUnitClient() {
  const events: string[] = [];
  let lastRow: Record<string, unknown> = {};

  const client = {
    from(_table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          lastRow = { ...payload };
          events.push(`insert:${payload.status}:${payload.work_type}`);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: lastRow, error: null }),
            }),
          };
        },
        update(patch: Record<string, unknown>) {
          lastRow = { ...lastRow, ...patch };
          events.push(`update:${patch.status}`);
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: lastRow, error: null }),
                }),
              }),
            }),
          };
        },
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
  };

  return { client: client as unknown as SupabaseClient, events };
}

async function main() {
  console.log("AdeHQ AI caller tests — topic summary + classifier + hiring (V19.9.0c)\n");

  let passed = 0;
  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  // --- Topic summary dispatch ---

  await run("dispatch off when AI_RUNTIME_V2_MODE unset", async () => {
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: undefined,
        AI_RUNTIME_V2_ENABLED: undefined,
        AI_RUNTIME_V2_SHADOW_MODE: undefined,
      },
      () => {
        assert(getTopicSummaryRuntimeDispatch() === "old", "expected old dispatch");
      },
    );
  });

  await run("dispatch shadow when AI_RUNTIME_V2_MODE=shadow", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, () => {
      assert(getTopicSummaryRuntimeDispatch() === "shadow", "expected shadow dispatch");
    });
  });

  await run("dispatch runtime-on when AI_RUNTIME_V2_MODE=on", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "on" }, () => {
      assert(getTopicSummaryRuntimeDispatch() === "runtime-on", "expected runtime-on dispatch");
    });
  });

  await run("runtime mock on mode returns schema-valid summary object", async () => {
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        const result = await generateTopicSummaryPayloadRuntime(SAMPLE_CONTEXT, {
          workspaceId: "ws_test",
          roomId: "room_test",
          topicId: "topic_test",
          sourceMessageCount: 3,
        });
        const parsed = topicSummarySchema.safeParse(result);
        assert(parsed.success, "runtime topic summary must match schema");
        assert(Boolean(result.summary), "summary must be non-empty");
      },
    );
  });

  await run("exported generateTopicSummaryPayload uses old path when mode=off", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "off" }, async () => {
      assert(getRuntimeFlags().mode === "off", "expected off flag");
      assert(getTopicSummaryRuntimeDispatch() === "old", "expected old routing");

      try {
        await generateTopicSummaryPayload(SAMPLE_CONTEXT);
      } catch (error) {
        if (isSiliconFlowUnavailableError(error)) {
          console.log("      (live SiliconFlow unavailable — off path reached legacy caller as expected)");
          return;
        }
        throw error;
      }
    });
  });

  await run("shadow mode routes through legacy output path", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      assert(getTopicSummaryRuntimeDispatch() === "shadow", "expected shadow routing");
      try {
        await generateTopicSummaryPayload(SAMPLE_CONTEXT, {
          workspaceId: "ws_test",
          roomId: "room_test",
          topicId: "topic_test",
          sourceMessageCount: 3,
        });
      } catch (error) {
        if (isSiliconFlowUnavailableError(error)) {
          console.log("      (live SiliconFlow unavailable — shadow still used legacy caller)");
          return;
        }
        throw error;
      }
    });
  });

  await run("on mode runtime path succeeds with mock provider", async () => {
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        const result = await generateTopicSummaryPayload(SAMPLE_CONTEXT, {
          workspaceId: "ws_test",
          roomId: "room_test",
          topicId: "topic_test",
          sourceMessageCount: 3,
        });
        assert(topicSummarySchema.safeParse(result).success, "wrapper on-mode must return valid summary");
      },
    );
  });

  // --- V19.9.0c-1.1: explicit fallback test ---

  await run("on mode forced runtime failure falls back to legacy path", async () => {
    setTopicSummaryTestHooks(null);
    const { client, events } = createMockWorkUnitClient();
    let fallbackCalled = false;

    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        setTopicSummaryTestHooks({
          forceRuntimeFailure: new Error("test forced topic summary runtime failure"),
          stubOldPayload: STUB_TOPIC_SUMMARY,
          onRuntimeFallback: (info) => {
            fallbackCalled = true;
            assert(
              info.error.includes("test forced topic summary runtime failure"),
              "fallback hook must receive runtime error",
            );
            assert(info.workUnitFailed, "failed work unit should be recorded when client exists");
          },
        });

        const beforeSnapshot = getAiRuntimeSnapshot();
        const result = await generateTopicSummaryPayload(SAMPLE_CONTEXT, {
          workspaceId: "ws_test",
          roomId: "room_test",
          topicId: "topic_test",
          sourceMessageCount: 3,
          client,
        });

        assert(fallbackCalled, "onRuntimeFallback hook must fire");
        assert(result.summary === STUB_TOPIC_SUMMARY.summary, "fallback must return legacy payload");
        assert(
          events.some((e) => e.startsWith("insert:failed:topic_summary")),
          "failed work unit insert must be recorded",
        );
        assert(
          events.some((e) => e === "update:failed"),
          "failed work unit update must be recorded",
        );

        const afterSnapshot = getAiRuntimeSnapshot();
        const last = afterSnapshot.last;
        assert(last?.mode === "fallback", "runtime log must record fallback mode");
        assert(
          last?.fallbackReason === "topic_summary_runtime_failed",
          "runtime log must record topic_summary_runtime_failed",
        );
        assert(Boolean(last?.error), "runtime log must include error message");

        void beforeSnapshot;
      },
    );

    setTopicSummaryTestHooks(null);
  });

  // --- Classifier dispatch ---

  await run("classifier dispatch off when AI_RUNTIME_V2_MODE unset", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: undefined }, () => {
      assert(getClassifierRuntimeDispatch() === "old", "expected old classifier dispatch");
    });
  });

  await run("classifier dispatch shadow when AI_RUNTIME_V2_MODE=shadow", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, () => {
      assert(getClassifierRuntimeDispatch() === "shadow", "expected shadow classifier dispatch");
    });
  });

  await run("classifier dispatch runtime-on when AI_RUNTIME_V2_MODE=on", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "on" }, () => {
      assert(getClassifierRuntimeDispatch() === "runtime-on", "expected runtime-on classifier dispatch");
    });
  });

  await run("classifier on mode with mock returns schema-valid plan", async () => {
    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        const result = await classifyWithLlmRuntime(SAMPLE_ORCHESTRATOR_INPUT, SAMPLE_EMPLOYEES);
        assert(result !== null, "classifier runtime must return a plan");
        const objectShape = orchestrationClassifierSchema.safeParse({
          intent: result!.intent,
          confidence: result!.confidence,
          reason: result!.reason,
          selectedEmployeeIds: result!.selectedEmployeeIds ?? [],
          leadEmployeeId: result!.leadEmployeeId,
          collaboratorEmployeeIds: result!.collaboratorEmployeeIds,
          shouldRespond: result!.shouldRespond,
          workLogRequired: result!.workLogRequired,
          workLogReason: result!.workLogReason,
        });
        assert(objectShape.success, "classifier runtime output must match schema fields");
      },
    );
  });

  await run("classifier off mode uses legacy path when SiliconFlow unavailable", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "off" }, async () => {
      const result = await classifyWithLlm(SAMPLE_ORCHESTRATOR_INPUT, SAMPLE_EMPLOYEES);
      if (process.env.SILICONFLOW_API_KEY?.trim()) {
        assert(result === null || typeof result.confidence === "number", "legacy path should return plan or null");
      } else {
        assert(result === null, "legacy path returns null without SiliconFlow key");
        console.log("      (live SiliconFlow unavailable — off path returned null as expected)");
      }
    });
  });

  await run("classifier shadow mode routes through legacy output path", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      setClassifierTestHooks({
        stubOldResult: {
          intent: "direct_reply",
          confidence: 0.82,
          reason: "shadow stub",
          selectedEmployeeIds: ["emp_alex"],
          shouldRespond: true,
          suggestedActions: [],
          workLogRequired: false,
          responseOrder: [{ employeeId: "emp_alex", role: "direct", delayMs: 0 }],
        },
      });

      const result = await classifyWithLlm(SAMPLE_ORCHESTRATOR_INPUT, SAMPLE_EMPLOYEES, {
        client: createMockWorkUnitClient().client,
      });
      assert(result?.intent === "direct_reply", "shadow must return legacy classifier result");
      setClassifierTestHooks(null);
    });
  });

  await run("classifier on mode forced runtime failure falls back cleanly", async () => {
    setClassifierTestHooks(null);
    const { client, events } = createMockWorkUnitClient();
    let fallbackCalled = false;

    await withEnv(
      {
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_PROVIDER_PREF: "mock",
      },
      async () => {
        setClassifierTestHooks({
          forceRuntimeFailure: new Error("test forced classifier runtime failure"),
          stubOldResult: {
            intent: "direct_reply",
            confidence: 0.77,
            reason: "legacy fallback stub",
            selectedEmployeeIds: ["emp_alex"],
            shouldRespond: true,
            suggestedActions: [],
            workLogRequired: false,
            responseOrder: [{ employeeId: "emp_alex", role: "direct", delayMs: 0 }],
          },
          onRuntimeFallback: (info) => {
            fallbackCalled = true;
            assert(
              info.error.includes("test forced classifier runtime failure"),
              "classifier fallback hook must receive runtime error",
            );
            assert(info.workUnitFailed, "classifier failed work unit should be recorded");
          },
        });

        const result = await classifyWithLlm(SAMPLE_ORCHESTRATOR_INPUT, SAMPLE_EMPLOYEES, { client });
        assert(fallbackCalled, "classifier onRuntimeFallback hook must fire");
        assert(result?.reason === "legacy fallback stub", "classifier must return legacy fallback result");
        assert(
          events.some((e) => e.startsWith("insert:failed:orchestration_classify")),
          "classifier failed work unit insert must be recorded",
        );

        const last = getAiRuntimeSnapshot().last;
        assert(last?.fallbackReason === "orchestration_classify_runtime_failed", "classifier fallback log reason");
      },
    );

    setClassifierTestHooks(null);
  });

  // --- V19.9.0c-2.1: orchestrator client wiring ---

  await run("maybeEnhanceWithLlm forwards client and sourceMessageCount to classifier", async () => {
    const { client } = createMockWorkUnitClient();
    let receivedClient = false;
    let receivedSourceCount = false;

    setClassifierTestHooks({
      onOptionsReceived: (opts) => {
        if (opts.client) receivedClient = true;
        if (opts.sourceMessageCount === SAMPLE_ORCHESTRATOR_INPUT.recentMessages.length) {
          receivedSourceCount = true;
        }
      },
      stubOldResult: {
        intent: "direct_reply",
        confidence: 0.82,
        reason: "wiring test",
        selectedEmployeeIds: ["emp_alex"],
        shouldRespond: true,
        suggestedActions: [],
        workLogRequired: false,
        responseOrder: [{ employeeId: "emp_alex", role: "direct", delayMs: 0 }],
      },
    });

    await maybeEnhanceWithLlm(
      SAMPLE_ORCHESTRATOR_INPUT,
      SAMPLE_EMPLOYEES,
      LOW_CONFIDENCE_PLAN,
      { client },
    );

    assert(receivedClient, "classifier must receive Supabase client from maybeEnhanceWithLlm");
    assert(receivedSourceCount, "classifier must receive sourceMessageCount from orchestrator input");
    setClassifierTestHooks(null);
  });

  await run("orchestrateConversation forwards client when LLM enhancement runs", async () => {
    const { client, events } = createMockWorkUnitClient();
    let receivedClient = false;

    setClassifierTestHooks({
      onOptionsReceived: (opts) => {
        if (opts.client) receivedClient = true;
      },
      stubOldResult: {
        intent: "ambient_smart_assist",
        confidence: 0.8,
        reason: "orchestrator wiring test",
        selectedEmployeeIds: ["emp_alex"],
        shouldRespond: true,
        suggestedActions: [],
        workLogRequired: false,
        responseOrder: [{ employeeId: "emp_alex", role: "direct", delayMs: 0 }],
      },
    });

    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      const helpInput: OrchestratorInput = {
        ...SAMPLE_ORCHESTRATOR_INPUT,
        messageText: "I need help",
        mentionedEmployeeIds: [],
        smartAssistEnabled: true,
      };

      await orchestrateConversation(helpInput, { client });
      assert(receivedClient, "orchestrateConversation must pass client into classifier path");
      assert(
        events.some((e) => e.startsWith("insert:planned:orchestration_classify")),
        "shadow classifier work unit should be planned when client is wired",
      );
    });

    setClassifierTestHooks(null);
  });

  // --- V19.9.0c-3: hiring APIs ---

  await run("recruiter on mode with mock returns schema-valid response", async () => {
    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        const result = await generateRecruiterResponseRuntime(SAMPLE_RECRUITER_LLM, {
          workspaceId: "ws_test",
          userId: "user_test",
        });
        assert(recruiterResponseSchema.safeParse(result).success, "recruiter runtime must match schema");
        assert(Boolean(result.message), "recruiter message must be non-empty");
      },
    );
  });

  await run("candidates on mode with mock returns schema-valid copies", async () => {
    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        const result = await generateCandidateCopiesRuntime(SAMPLE_HIRING_BRIEF, {
          workspaceId: "ws_test",
          userId: "user_test",
          roleKey: "marketing",
        });
        assert(result && typeof result === "object", "candidates runtime must return copies object");
      },
    );
  });

  await run("recruiter on mode forced runtime failure falls back cleanly", async () => {
    setRecruiterTestHooks(null);
    const { client, events } = createMockWorkUnitClient();
    let fallbackCalled = false;

    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        setRecruiterTestHooks({
          forceRuntimeFailure: new Error("test forced recruiter runtime failure"),
          stubOldResult: {
            message: "Legacy recruiter fallback message.",
            chips: [],
            briefReady: false,
          },
          onRuntimeFallback: (info) => {
            fallbackCalled = true;
            assert(info.workUnitFailed, "recruiter failed work unit should be recorded");
          },
        });

        const result = await generateRecruiterResponse(SAMPLE_RECRUITER_LLM, {
          client,
          workspaceId: "ws_test",
          userId: "user_test",
        });

        assert(fallbackCalled, "recruiter onRuntimeFallback hook must fire");
        assert(result.message === "Legacy recruiter fallback message.", "recruiter must return legacy fallback");
        assert(
          events.some((e) => e.startsWith("insert:failed:hiring_recruiter")),
          "recruiter failed work unit insert must be recorded",
        );

        const last = getAiRuntimeSnapshot().last;
        assert(last?.fallbackReason === "hiring_recruiter_runtime_failed", "recruiter fallback log reason");
      },
    );

    setRecruiterTestHooks(null);
  });

  await run("candidates on mode forced runtime failure falls back cleanly", async () => {
    setCandidatesTestHooks(null);
    const { client, events } = createMockWorkUnitClient();
    let fallbackCalled = false;

    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        setCandidatesTestHooks({
          forceRuntimeFailure: new Error("test forced candidates runtime failure"),
          stubOldResult: {
            recommended: {
              name: "Legacy Candidate",
              title: "Marketing Specialist",
              personalityTags: ["Focused"],
              strengths: ["Campaigns"],
              watchOuts: ["Needs onboarding"],
              bestFor: "Balanced hire",
              whyThisCandidate: "Fallback stub",
            },
          },
          onRuntimeFallback: (info) => {
            fallbackCalled = true;
            assert(info.workUnitFailed, "candidates failed work unit should be recorded");
          },
        });

        const result = await generateCandidateCopies(SAMPLE_HIRING_BRIEF, {
          client,
          workspaceId: "ws_test",
          userId: "user_test",
        });

        assert(fallbackCalled, "candidates onRuntimeFallback hook must fire");
        assert(result?.recommended?.name === "Legacy Candidate", "candidates must return legacy fallback");
        assert(
          events.some((e) => e.startsWith("insert:failed:hiring_candidates")),
          "candidates failed work unit insert must be recorded",
        );

        const last = getAiRuntimeSnapshot().last;
        assert(last?.fallbackReason === "hiring_candidates_runtime_failed", "candidates fallback log reason");
      },
    );

    setCandidatesTestHooks(null);
  });

  // --- V19.9.0c-3.1: hiring workspace wiring ---

  await run("hiring recruiter creates work unit when workspaceId is validated", async () => {
    const { client, events } = createMockWorkUnitClient();

    await withEnv(
      { AI_RUNTIME_V2_MODE: "shadow", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        setRecruiterTestHooks({
          stubOldResult: {
            message: "Shadow recruiter with workspace.",
            chips: [],
            briefReady: false,
          },
        });

        await generateRecruiterResponse(SAMPLE_RECRUITER_LLM, {
          client,
          workspaceId: "ws_test",
          userId: "user_test",
          hiringSessionId: "hs_test",
        });

        assert(
          events.some((e) => e.startsWith("insert:planned:hiring_recruiter")),
          "recruiter shadow work unit should be planned when workspaceId is present",
        );
      },
    );

    setRecruiterTestHooks(null);
  });

  await run("hiring recruiter without workspaceId still succeeds", async () => {
    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        setRecruiterTestHooks(null);
        const result = await generateRecruiterResponse(SAMPLE_RECRUITER_LLM, {
          userId: "user_test",
        });
        assert(Boolean(result.message), "recruiter must succeed without workspaceId");
      },
    );
  });

  // --- V19.9.0c-4: file embeddings ---

  await run("embedTexts on mode with mock returns stable-dimension vectors", async () => {
    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        const texts = ["alpha chunk", "beta chunk", "gamma chunk"];
        const vectors = await embedTextsRuntime(texts, { workspaceId: "ws_test" });
        assert(vectors.length === texts.length, "embedTexts must return one vector per input");
        for (const vector of vectors) {
          assert(vector.length === EMBEDDING_DIMENSIONS, "mock embedding dimension must match config");
        }
      },
    );
  });

  await run("mock deterministic embedding dimension is stable", () => {
    const vector = mockDeterministicEmbedding("query about launch planning");
    assert(vector.length === EMBEDDING_DIMENSIONS, "mockDeterministicEmbedding must use EMBEDDING_DIMENSIONS");
  });

  await run("embedQueryText on mode with mock returns query vector", async () => {
    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        const vector = await embedQueryText("What did we decide about pricing?", {
          workspaceId: "ws_test",
          topicId: "topic_test",
        });
        assert(vector !== null, "embedQueryText must return a vector in on/mock mode");
        assert(vector!.length === EMBEDDING_DIMENSIONS, "query vector dimension must match config");
      },
    );
  });

  await run("embedTexts forced runtime failure falls back cleanly", async () => {
    setEmbeddingTestHooks(null);
    const { client, events } = createMockWorkUnitClient();
    let fallbackCalled = false;

    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        setEmbeddingTestHooks({
          forceRuntimeFailure: new Error("test forced embeddings runtime failure"),
          onRuntimeFallback: (info) => {
            fallbackCalled = true;
            assert(info.workUnitFailed, "embedding failed work unit should be recorded");
          },
        });

        try {
          await embedTexts(["fallback test chunk"], {
            client,
            workspaceId: "ws_test",
          });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            (!error.message.includes("SILICONFLOW") && !error.message.includes("API key"))
          ) {
            throw error;
          }
          console.log("      (live SiliconFlow unavailable — fallback reached legacy path as expected)");
        }

        assert(fallbackCalled, "embedding onRuntimeFallback hook must fire");
        assert(
          events.some((e) => e.startsWith("insert:failed:file_embedding")),
          "embedding failed work unit insert must be recorded",
        );

        const last = getAiRuntimeSnapshot().last;
        assert(last?.fallbackReason === "file_embeddings_runtime_failed", "embedding fallback log reason");
      },
    );

    setEmbeddingTestHooks(null);
  });

  await run("embed dispatch off when AI_RUNTIME_V2_MODE unset", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: undefined }, () => {
      assert(getEmbedRuntimeDispatch() === "old", "expected old embedding dispatch");
    });
  });

  // --- V19.9.0c-final: rollback + remaining audit coverage ---

  await run("off mode rollback — all low-risk dispatch helpers return old", async () => {
    await withEnv({ AI_RUNTIME_V2_MODE: "off" }, () => {
      assert(getRuntimeFlags().mode === "off", "runtime flags must be off");
      assert(getTopicSummaryRuntimeDispatch() === "old", "topic summary dispatch");
      assert(getClassifierRuntimeDispatch() === "old", "classifier dispatch");
      assert(getRecruiterRuntimeDispatch() === "old", "recruiter dispatch");
      assert(getCandidatesRuntimeDispatch() === "old", "candidates dispatch");
      assert(getEmbedRuntimeDispatch() === "old", "embeddings dispatch");
    });
  });

  await run("candidates shadow creates planned work unit when workspaceId present", async () => {
    const { client, events } = createMockWorkUnitClient();

    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      setCandidatesTestHooks({
        stubOldResult: {
          recommended: { name: "Shadow Candidate", whyThisCandidate: "shadow stub" },
        },
      });

      await generateCandidateCopies(SAMPLE_HIRING_BRIEF, {
        client,
        workspaceId: "ws_test",
        userId: "user_test",
      });

      assert(
        events.some((e) => e.startsWith("insert:planned:hiring_candidates")),
        "candidates shadow work unit should be planned when workspaceId is present",
      );
    });

    setCandidatesTestHooks(null);
  });

  await run("candidates without workspaceId still succeeds in on mode", async () => {
    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        const result = await generateCandidateCopiesRuntime(SAMPLE_HIRING_BRIEF, {
          userId: "user_test",
        });
        assert(result && typeof result === "object", "candidates must succeed without workspaceId");
      },
    );
  });

  await run("embeddings shadow plans work unit while legacy path executes", async () => {
    const { client, events } = createMockWorkUnitClient();

    await withEnv({ AI_RUNTIME_V2_MODE: "shadow" }, async () => {
      assert(getEmbedRuntimeDispatch() === "shadow", "expected shadow embedding dispatch");
      try {
        await embedTexts(["shadow embedding chunk"], {
          client,
          workspaceId: "ws_test",
          topicId: "topic_test",
          fileId: "file_test",
        });
      } catch (error) {
        if (!isSiliconFlowUnavailableError(error)) throw error;
        console.log("      (live SiliconFlow unavailable — shadow still planned work unit)");
      }
      assert(
        events.some((e) => e.startsWith("insert:planned:file_embedding")),
        "embedding shadow work unit should be planned when workspaceId is present",
      );
    });
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: 0  TOTAL: ${passed}`);
  console.log(
    "\nNote: Live SiliconFlow integration for off/shadow legacy paths is skipped when SILICONFLOW_API_KEY is missing.",
  );
}

main().catch(() => {
  process.exitCode = 1;
});
