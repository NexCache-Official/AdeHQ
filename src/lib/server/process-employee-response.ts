import type { SupabaseClient } from "@supabase/supabase-js";
import { createAmbientContext } from "@/lib/ai/ambient-context";
import { enforceEmployeePermissions } from "@/lib/ai/enforce-permissions";
import { dispatchEmployeeDirectResponse } from "@/lib/ai/runtime/employee-direct-runtime";
import { beginAiRun, finalizeAiRun } from "@/lib/ai/cost-guard";
import {
  defaultModelModeForRole,
  getOutputTokenCap,
  getTimeoutMs,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { appendRunStep } from "@/lib/supabase/ai-runtime";
import type { EmployeeResponse } from "@/lib/types";
import { persistEmployeeEffects, type RoomContext } from "@/lib/server/room-messages";
import {
  buildFileContextPrompt,
  detectArtifactIntent,
  loadAttachmentFileIds,
  retrieveFileContext,
} from "@/lib/server/file-context";
import { executeVisionUnderstanding, shouldRunVision } from "@/lib/brain/vision";
import { buildWorkHoursBudgetPrompt } from "@/lib/brain/video";
import { isBrainVideoV1Enabled, isBrainImageV1Enabled } from "@/lib/brain/flags";
import { inferArtifactsFromReply } from "@/lib/artifacts/intelligence";
import { resolveRunModelMode } from "@/lib/ai/resolve-run-model-mode";
import { ensureDefaultEmployeeToolGrants } from "@/lib/integrations/permissions";
import {
  planEmployeeReplyShadowRun,
  recordEmployeeReplyShadowResult,
  resolveEmployeeShadowOldModel,
} from "@/lib/ai/runtime/hot-path-shadow";
import { resolveInstantAnswer } from "@/lib/ai/intelligence/instant-answers";
import { resolveEmployeePromptTier } from "@/lib/ai/employee-prompt-tier";
import {
  isShortToolRetryMessage,
  messageLikelyNeedsResearch,
} from "@/lib/ai/message-intent";
import {
  isAffirmativeSearchFollowUp,
  isMetaResearchInstruction,
  resolveResearchQuery,
} from "@/lib/ai/research/resolve-research-query";
import { executeSearchAnswer } from "@/lib/ai/search/search-answer";

export type ProcessEmployeeOptions = {
  mode?: "mock" | "live";
  triggerMessageId?: string;
  skipCostGuard?: boolean;
  /** Human who initiated the response — stamps Brain reliability envelope. */
  initiatedByUserId?: string;
  /** Preserve the normal Brain while adapting only the spoken presentation. */
  voiceCall?: boolean;
  onReplyDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
  /** Return metered output without writing a room message/effects (for private call sidecars). */
  persistToRoom?: boolean;
  onActivity?: (
    activity: "thinking" | "searching" | "using_tool" | "speaking",
    detail?: string,
  ) => void;
};

export async function processEmployeeResponse(
  client: SupabaseClient,
  ctx: RoomContext,
  employeeId: string,
  content: string,
  options: ProcessEmployeeOptions = {},
): Promise<
  EmployeeResponse & {
    aiMessageId: string;
    aiMode: string;
    agentRunId?: string;
    /** Live-search answer used to ground voice turns when the model leaks junk. */
    voiceGroundingAnswer?: string;
  }
> {
  const roomEmployee = ctx.employees.find((e) => e.id === employeeId);
  if (!roomEmployee) {
    throw new Error("Employee not found in this room.");
  }

  if (!ctx.room.aiEmployees.includes(employeeId)) {
    throw new Error("Employee is not a member of this room.");
  }

  // Seed default integration tool grants for employees hired before the
  // Integration Layer, so the prompt lists the tools they can actually use.
  const employee = await ensureDefaultEmployeeToolGrants(client, ctx.workspaceId, roomEmployee);

  const instant = resolveInstantAnswer({
    message: content,
    ambient: createAmbientContext({
      workspaceName: ctx.workspaceName,
      userName: ctx.humanParticipants[0]?.name,
    }),
    employeeName: employee.name,
    roomName: ctx.room.name,
    topicTitle: ctx.topic.title,
    topicDescription: ctx.topic.description,
    topicSummary: ctx.topicSummary?.summary,
    openTasks: ctx.openTasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
    })),
    roomEmployees: ctx.employees.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
    })),
    humanParticipants: ctx.humanParticipants,
  });

  if (instant) {
    // Live calls need spoken audio immediately — stream the instant reply
    // through the same delta path the SpeechChunker/TTS session already use.
    if (options.voiceCall && options.onReplyDelta) {
      options.onReplyDelta(instant.reply);
    }
    const aiMessage =
      options.persistToRoom === false
        ? { id: `private:${employee.id}:${Date.now()}` }
        : (
            await persistEmployeeEffects(
              client,
              ctx.workspaceId,
              ctx.room.id,
              ctx.topic.id,
              employee,
              instant.reply,
              { workLog: [], tasks: [], memory: [], approvals: [] },
              options.triggerMessageId,
            )
          ).aiMessage;

    await client
      .from("ai_employees")
      .update({ status: "idle", last_active_at: new Date().toISOString() })
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", employeeId);

    return {
      employeeId: employee.id,
      employeeName: employee.name,
      reply: instant.reply,
      effect: { workLog: [], tasks: [], memory: [], approvals: [] },
      aiMessageId: aiMessage.id,
      aiMode: "instant_answer",
    };
  }

  await client
    .from("ai_employees")
    .update({ status: "working", last_active_at: new Date().toISOString() })
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", employeeId);

  const topicId = ctx.topic.id;
  const attachmentFileIds = options.triggerMessageId
    ? await loadAttachmentFileIds(client, ctx.workspaceId, options.triggerMessageId)
    : [];
  const artifactIntent = detectArtifactIntent(content);
  options.onActivity?.("thinking");
  // Voice turns pay for every DB round-trip. Skip Drive retrieval unless the
  // user attached files or clearly asked about a document.
  const shouldRetrieveFiles =
    attachmentFileIds.length > 0 ||
    (!options.voiceCall && Boolean(content.trim())) ||
    (options.voiceCall &&
      /\b(?:file|drive|doc|document|pdf|spreadsheet|sheet|attachment|upload)\b/i.test(
        content,
      ));
  const fileContextBundle = shouldRetrieveFiles
    ? await retrieveFileContext(client, ctx.workspaceId, topicId, {
        userMessage: content,
        priorityFileIds: attachmentFileIds,
      })
    : { chunks: [], files: [], chunkIds: new Set<string>(), fileIds: new Set<string>() };
  let fileContextPrompt = buildFileContextPrompt(fileContextBundle);
  if (options.voiceCall) {
    fileContextPrompt = [
      fileContextPrompt,
      [
        "CALL PRESENTATION POLICY (presentation only; all normal permissions, tools, memory, and routing still apply):",
        "You are on a live phone call with a teammate — sound human, not scripted.",
        "Lead with the answer in the first short clause. Default to one to three spoken sentences and about 25–80 words unless they ask for more.",
        "Use contractions and natural phrasing. Occasional light spoken connective is fine (\"So —\", \"Alright —\"), but do not stall with empty hedges.",
        "If the useful answer is long, break it into short spoken beats: decision first, then one supporting point, then offer to go deeper. Put lists, tables, and source trails in the durable chat transcript.",
        "Never reuse a generic check-in opener (e.g. \"Anything on your mind?\") when the user is continuing a prior ask — especially short replies like yes/yeah/sure/ok.",
        "If they ask to search/research without repeating the topic, infer it from the recent conversation and answer from LIVE WEB SEARCH RESULTS / CRM context — do not ask them to wait again.",
        "For public-company / web facts, use the live search results already provided. Never invent numbers, and do not ask them to upload a Drive file unless the data is clearly internal.",
        "Never answer a search ask with only a deferral like \"Got it — I'll follow up\" or \"I'll look into that.\" Either speak the useful findings now, or say the web lookup failed and give the best CRM/workspace answer you already have.",
        "When tools or search will take time, do not invent holding phrases — the call runtime already plays intelligent spoken fillers.",
        "Avoid markdown, tables, citation identifiers, and raw URLs in spoken lines. Put detail in the durable chat transcript.",
      ].join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const usedFileContext = fileContextBundle.chunks.length > 0;

  if (
    shouldRunVision({
      attachmentFileIds,
      hasVisualAssets: attachmentFileIds.length > 0,
      userMessage: content,
    })
  ) {
    try {
      options.onActivity?.("using_tool", "Analyzing attached visuals");
      const vision = await executeVisionUnderstanding({
        client,
        workspaceId: ctx.workspaceId,
        roomId: ctx.room.id,
        topicId,
        employeeId,
        messageId: options.triggerMessageId,
        userMessage: content,
        attachmentFileIds,
      });
      if (vision?.promptBlock) {
        fileContextPrompt = [fileContextPrompt, vision.promptBlock].filter(Boolean).join("\n\n");
      }
    } catch (error) {
      console.warn(
        "[AdeHQ vision] skipped (direct)",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (isBrainVideoV1Enabled() || isBrainImageV1Enabled()) {
    try {
      const budgetPrompt = await buildWorkHoursBudgetPrompt(client, ctx.workspaceId);
      if (budgetPrompt) {
        fileContextPrompt = [fileContextPrompt, budgetPrompt].filter(Boolean).join("\n\n");
      }
    } catch (error) {
      console.warn(
        "[AdeHQ video] WH budget context skipped (direct)",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const roomWithMessages = {
    ...ctx.room,
    messages: [
      ...ctx.room.messages,
      {
        id: options.triggerMessageId ?? "trigger",
        roomId: ctx.room.id,
        topicId,
        senderType: "human" as const,
        senderId: "user",
        senderName: "User",
        content,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  // Voice calls share this direct path (not the queued intelligence run). When
  // the user asks to research/look something up — including short follow-ups
  // like "yes" / "google that" after a prior topic — run a quick web search and
  // feed findings into the spoken reply so the employee doesn't invent numbers
  // or ask for a Drive file that does not exist.
  let voiceGroundingAnswer: string | undefined;
  if (options.voiceCall) {
    const resolved = resolveResearchQuery({
      userMessage: content,
      messages: roomWithMessages.messages,
      excludeMessageId: options.triggerMessageId,
    });
    const affirmativeSearch = isAffirmativeSearchFollowUp(
      content,
      roomWithMessages.messages,
      options.triggerMessageId,
    );
    const shouldSearch =
      Boolean(resolved.query.trim()) &&
      (messageLikelyNeedsResearch(content) ||
        isMetaResearchInstruction(content) ||
        affirmativeSearch ||
        (isShortToolRetryMessage(content) && messageLikelyNeedsResearch(resolved.query)));
    if (shouldSearch) {
      try {
        options.onActivity?.("searching", "Looking that up");
        // Refinements like "recent financials" after "research Tesla" should keep
        // the company/topic from the prior human turn in the search query.
        let searchQuery = resolved.query.trim();
        const priorResearchAsk = [...roomWithMessages.messages]
          .reverse()
          .find(
            (message) =>
              message.senderType === "human" &&
              message.id !== options.triggerMessageId &&
              messageLikelyNeedsResearch(message.content) &&
              message.content.trim().toLowerCase() !== content.trim().toLowerCase(),
          );
        const refinementOnly =
          /^(?:i (?:would like|want).{0,40})?(?:for you to )?(?:review|check|see|get|pull up)\b/i.test(
            searchQuery,
          ) ||
          /^(?:the )?(?:recent )?(?:financials?|earnings|numbers|filings?)\b/i.test(searchQuery);
        if (priorResearchAsk && refinementOnly) {
          searchQuery = `${priorResearchAsk.content.trim()} — ${searchQuery}`;
        }
        const search = await executeSearchAnswer({
          client,
          workspaceId: ctx.workspaceId,
          roomId: ctx.room.id,
          topicId,
          employeeId,
          employeeName: employee.name,
          query: searchQuery,
          agentRunId: undefined,
          // Voice needs first audio fast; prefer the short fact preset.
          preferAgentMode: false,
          searchMode: "fast_fact",
        });
        if (search.answer?.trim()) {
          voiceGroundingAnswer = search.answer.trim();
          const sourceLines = (search.sources ?? [])
            .slice(0, 3)
            .map((source, index) => {
              const title = source.title || source.url || `Source ${index + 1}`;
              return `- ${title}`;
            })
            .join("\n");
          fileContextPrompt = [
            fileContextPrompt,
            [
              "LIVE WEB SEARCH RESULTS (use these; do not invent figures):",
              `Query: ${searchQuery}`,
              voiceGroundingAnswer,
              sourceLines ? `Sources:\n${sourceLines}` : "",
              "Speak the useful findings now in 1–3 short sentences. Do not defer. Offer to go deeper only after answering.",
              "Never emit tool XML, <minimax:tool_call>, <invoke>, or [TOOL_CALL] blocks — answer in plain spoken prose only.",
            ]
              .filter(Boolean)
              .join("\n"),
          ]
            .filter(Boolean)
            .join("\n\n");
        } else {
          fileContextPrompt = [
            fileContextPrompt,
            "LIVE WEB SEARCH returned no usable answer. Say that briefly, then answer from CRM/workspace context if available — do not invent web facts and do not only say you'll follow up.",
          ]
            .filter(Boolean)
            .join("\n\n");
        }
      } catch (error) {
        console.warn(
          "[AdeHQ voice-call] search skipped",
          error instanceof Error ? error.message : error,
        );
        fileContextPrompt = [
          fileContextPrompt,
          "LIVE WEB SEARCH unavailable right now. Be honest that you couldn't reach the web, and ask whether to retry — do not invent financial figures.",
        ]
          .filter(Boolean)
          .join("\n\n");
      }
    }
  }

  const isLive = options.mode !== "mock" && employee.provider.toLowerCase() !== "mock";
  const modelMode: ModelMode = employee.modelMode ?? defaultModelModeForRole(employee.roleKey);
  const provider = employee.provider.toLowerCase();
  const promptTier = resolveEmployeePromptTier({
    message: content,
    workMode: undefined,
    hasFileContext: usedFileContext,
    hasArtifactIntent: Boolean(artifactIntent),
    hasImportedContext: Boolean(ctx.importedContextBlock),
  });

  let runId: string | undefined;
  let brainRunId: string | undefined;
  let usageId: string | undefined;
  let maxOutputTokens: number | undefined;

  if (isLive && !options.skipCostGuard && options.triggerMessageId) {
    const begun = await beginAiRun({
      client,
      workspaceId: ctx.workspaceId,
      employeeId,
      roomId: ctx.room.id,
      topicId,
      triggerMessageId: options.triggerMessageId,
      provider,
      modelMode,
      promptLength: content.length,
      explicitModel: employee.model,
    });

    if (!begun.ok) {
      const blockedReply: EmployeeResponse = {
        employeeId: employee.id,
        employeeName: employee.name,
        reply: `I couldn't run right now.\n\n**Reason:** ${begun.reason}`,
        effect: {
          workLog: [{ action: "Run blocked", summary: begun.reason, status: "failed" }],
          tasks: [],
          memory: [],
          approvals: [],
          statusChange: "idle",
        },
      };

      const aiMessage =
        options.persistToRoom === false
          ? { id: `private:${employee.id}:${Date.now()}` }
          : (
              await persistEmployeeEffects(
                client,
                ctx.workspaceId,
                ctx.room.id,
                topicId,
                employee,
                blockedReply.reply,
                blockedReply.effect,
                options.triggerMessageId,
              )
            ).aiMessage;

      return { ...blockedReply, aiMessageId: aiMessage.id, aiMode: "blocked" };
    }

    runId = begun.runId;
    usageId = begun.usageId;
    maxOutputTokens = begun.maxOutputTokens;

    // PR-17.5: stamp unified Brain run + permission envelope (non-fatal)
    const initiatorId =
      options.initiatedByUserId ?? ctx.humanParticipants[0]?.id ?? null;
    if (initiatorId) {
      try {
        const { beginUnifiedBrainRun } = await import("@/lib/brain/reliability/lifecycle");
        const intensity =
          modelMode === "cheap"
            ? "fast"
            : modelMode === "strong"
              ? "deep"
              : modelMode === "long_context"
                ? "research"
                : "standard";
        const begunBrain = await beginUnifiedBrainRun(client, {
          workspaceId: ctx.workspaceId,
          initiatedByUserId: initiatorId,
          leadEmployeeId: employeeId,
          roomId: ctx.room.id,
          topicId,
          triggerMessageId: options.triggerMessageId,
          intensity,
          agentRunId: runId,
        });
        brainRunId = begunBrain.brainRunId;
        const { data: existingRun } = await client
          .from("agent_runs")
          .select("run_metadata")
          .eq("workspace_id", ctx.workspaceId)
          .eq("id", runId)
          .maybeSingle();
        const priorMeta =
          existingRun?.run_metadata && typeof existingRun.run_metadata === "object"
            ? (existingRun.run_metadata as Record<string, unknown>)
            : {};
        await client
          .from("agent_runs")
          .update({
            run_metadata: { ...priorMeta, brainRunId, reliability: "pr17_5" },
          })
          .eq("workspace_id", ctx.workspaceId)
          .eq("id", runId);
      } catch (err) {
        console.warn("[AdeHQ brain reliability] beginUnifiedBrainRun", err);
      }
    }

    await appendRunStep(client, {
      workspaceId: ctx.workspaceId,
      agentRunId: runId,
      roomId: ctx.room.id,
      topicId,
      employeeId,
      stepType: "thinking",
      title: "Preparing response",
      summary: `${provider} · ${modelMode}`,
      status: "running",
    });
  }

  const { oldProvider, oldModel, oldModelMode } = resolveEmployeeShadowOldModel({
    provider: employee.provider,
    modelMode,
    explicitModel: employee.model,
  });
  const shadowResolvedModelMode = resolveRunModelMode({
    roleKey: employee.roleKey,
    employeeModelMode: employee.modelMode,
    userMessage: content,
  });
  const dmId = ctx.room.kind === "dm" ? ctx.room.dmEmployeeId : undefined;

  const shadowPlan = await planEmployeeReplyShadowRun({
    client,
    workspaceId: ctx.workspaceId,
    employeeId: employee.id,
    employeeName: employee.name,
    roleKey: employee.roleKey,
    roomId: ctx.room.id,
    topicId,
    dmId,
    messageId: options.triggerMessageId,
    userMessage: content,
    oldProvider,
    oldModel,
    oldModelMode,
    resolvedRunModelMode: shadowResolvedModelMode,
    artifactIntent: artifactIntent ?? undefined,
    agentRunId: runId,
    source: "employee_direct_response_shadow",
  });

  const routeInput = {
    employee,
    room: roomWithMessages,
    topic: ctx.topic,
    message: content,
    allEmployees: ctx.employees,
    recentMemory: ctx.recentMemory,
    topicTasks: ctx.openTasks,
    topicApprovals: ctx.topicApprovals,
    topicWorkLogs: ctx.topicWorkLogs,
    workspaceName: ctx.workspaceName,
    openTasks: ctx.openTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
    })),
    humanParticipants: ctx.humanParticipants,
    fileContextPrompt: fileContextPrompt || undefined,
    artifactIntent,
    importedContextPrompt: ctx.importedContextBlock,
  };
  const routeOptions = {
    mode: options.mode,
    provider: employee.provider,
    modelMode,
    promptTier,
    // Live calls need first spoken tokens fast — keep replies short and fail
    // closed on long Brain stalls instead of sitting in silence.
    maxOutputTokens: options.voiceCall
      ? Math.min(maxOutputTokens ?? 280, 280)
      : (maxOutputTokens ?? getOutputTokenCap(modelMode)),
    timeoutMs: options.voiceCall ? 12_000 : getTimeoutMs(modelMode),
    voiceCall: options.voiceCall,
    context: {
      workspaceId: ctx.workspaceId,
      roomId: ctx.room.id,
      topicId,
      agentRunId: runId,
      client,
    },
  };

  const {
    response,
    aiMode,
    metrics,
    failed,
    errorMessage,
    usedRuntime,
  } = await dispatchEmployeeDirectResponse(
    routeInput,
    routeOptions,
    options.onReplyDelta
      ? {
          onReplyDelta: options.onReplyDelta,
          abortSignal: options.abortSignal,
        }
      : undefined,
  );
  if ((response.effect.toolCalls?.length ?? 0) > 0) {
    options.onActivity?.("using_tool", "Using workspace tools");
  }
  options.onActivity?.("speaking");

  await recordEmployeeReplyShadowResult({
    client,
    workspaceId: ctx.workspaceId,
    employeeId: employee.id,
    employeeName: employee.name,
    roleKey: employee.roleKey,
    roomId: ctx.room.id,
    topicId,
    dmId,
    messageId: options.triggerMessageId,
    userMessage: content,
    oldProvider,
    oldModel,
    oldModelMode,
    resolvedRunModelMode: shadowResolvedModelMode,
    artifactIntent: artifactIntent ?? undefined,
    agentRunId: runId,
    workUnitId: shadowPlan?.workUnitId,
    routing: shadowPlan?.routing,
    actualProvider: metrics ? (usedRuntime ? "runtime-v2" : oldProvider) : undefined,
    actualModel: metrics?.model,
    actualModelMode: modelMode,
    actualCostUsd: metrics?.estimatedCostUsd,
    inputTokens: metrics?.inputTokens,
    outputTokens: metrics?.outputTokens,
    durationMs: metrics?.durationMs,
    aiMode,
    failed: failed || aiMode === "error",
    source: "employee_direct_response_shadow",
  });

  const effect = enforceEmployeePermissions(employee, response.effect);

  const inferred = inferArtifactsFromReply(
    content,
    response.reply,
    effect.artifacts ?? [],
    effect.emailDrafts ?? [],
  );
  const mergedEffect = {
    ...effect,
    artifacts: inferred.artifacts,
    emailDrafts: inferred.emailDrafts,
  };
  const finalReply = inferred.reply;

  if (runId && effect.memory.length) {
    await appendRunStep(client, {
      workspaceId: ctx.workspaceId,
      agentRunId: runId,
      roomId: ctx.room.id,
      topicId,
      employeeId,
      stepType: "memory_write",
      title: "Saving memory",
      summary: `${effect.memory.length} entr${effect.memory.length === 1 ? "y" : "ies"}`,
      status: "success",
    });
  }
  if (runId && effect.tasks.length) {
    await appendRunStep(client, {
      workspaceId: ctx.workspaceId,
      agentRunId: runId,
      roomId: ctx.room.id,
      topicId,
      employeeId,
      stepType: "task_create",
      title: "Creating tasks",
      summary: `${effect.tasks.length} task(s)`,
      status: "success",
    });
  }
  if (runId && effect.approvals.length) {
    await appendRunStep(client, {
      workspaceId: ctx.workspaceId,
      agentRunId: runId,
      roomId: ctx.room.id,
      topicId,
      employeeId,
      stepType: "approval_request",
      title: "Requesting approval",
      summary: effect.approvals.map((a) => a.title).join(", "),
      status: "success",
    });
  }

  const aiMessage =
    options.persistToRoom === false
      ? { id: `private:${employee.id}:${runId ?? Date.now()}` }
      : (
          await persistEmployeeEffects(
            client,
            ctx.workspaceId,
            ctx.room.id,
            topicId,
            employee,
            finalReply,
            mergedEffect,
            options.triggerMessageId,
            runId,
            {
              fileContext: fileContextBundle,
              usedFileContext,
            },
          )
        ).aiMessage;

  if (isLive && runId && usageId && !options.skipCostGuard) {
    await finalizeAiRun({
      client,
      workspaceId: ctx.workspaceId,
      runId,
      usageId,
      responseMessageId: options.persistToRoom === false ? undefined : aiMessage.id,
      inputTokens: metrics?.inputTokens,
      outputTokens: metrics?.outputTokens,
      cachedTokens: metrics?.cachedTokens,
      actualCostUsd: metrics?.estimatedCostUsd,
      latencyMs: metrics?.durationMs,
      fallbackUsed: metrics?.fallbackUsed,
      failed: failed || aiMode === "error",
      errorMessage,
    });
  }

  if (brainRunId) {
    try {
      const { finishBrainRun } = await import("@/lib/brain/reliability/lifecycle");
      await finishBrainRun(
        client,
        brainRunId,
        failed || aiMode === "error" ? "failed" : "completed",
      );
    } catch (err) {
      console.warn("[AdeHQ brain reliability] finishBrainRun", err);
    }
  }

  return {
    ...response,
    reply: finalReply,
    effect: mergedEffect,
    aiMessageId: aiMessage.id,
    aiMode,
    agentRunId: runId,
    ...(voiceGroundingAnswer ? { voiceGroundingAnswer } : {}),
  };
}
