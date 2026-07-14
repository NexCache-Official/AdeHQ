/**
 * Slice D inbox → platform work actions (idempotent, privacy-safe bridge).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthError } from "@/lib/supabase/auth-server";
import { insertHumanMessage } from "@/lib/server/room-messages";
import { ensureGeneralTopic } from "@/lib/server/topic-helpers";
import { queueAgentRuns } from "@/lib/server/queue-agent-runs";
import { nowISO, uid } from "@/lib/utils";
import type { AIEmployee } from "@/lib/types";
import { recordEmailEvent } from "./audit";
import {
  buildEmailWorkContext,
  formatEmailWorkBridgeMessage,
  provenanceFromContext,
  type EmailWorkContext,
  type EmailWorkProvenance,
} from "./work-context";
import {
  EMAIL_WORK_RELATIONS,
  listActiveEdgesForThread,
  unlinkWorkGraphEdge,
  upsertWorkGraphEdge,
  type WorkGraphEdgeRow,
} from "./work-graph";
import { completeWorkAction, findWorkAction } from "./work-idempotency";
import {
  assertCanBridgeIntoRoom,
  assertCanCreateRoom,
  assertInboxWorkOrganize,
  loadWorkAssignableEmployee,
} from "./work-permissions";
import type { InboxAccess } from "./access";
import { isMayaEmployee } from "@/lib/maya-employee";
import { resolveMemoryInsert } from "@/lib/memory/dedupe";
import { uid as memoryUid } from "@/lib/utils";

export type WorkActionBase = {
  client: SupabaseClient;
  workspaceId: string;
  mailboxId: string;
  threadId: string;
  userId: string;
  userName: string;
  access: InboxAccess;
  clientActionId: string;
};

type ThreadWorkSource = {
  subject: string;
  stewardMeta: Record<string, unknown>;
  dealId: string | null;
  assignedEmployeeId: string | null;
  latestMessage: {
    id: string;
    textBody: string | null;
    fromAddress: string | null;
    toAddresses: string[];
    createdAt: string;
    hasAttachments: boolean;
  } | null;
};

async function loadThreadWorkSource(
  client: SupabaseClient,
  workspaceId: string,
  mailboxId: string,
  threadId: string,
): Promise<ThreadWorkSource> {
  const { data: thread, error } = await client
    .from("email_threads")
    .select("id, subject, steward_meta, deal_id, assigned_employee_id, mailbox_id")
    .eq("id", threadId)
    .eq("workspace_id", workspaceId)
    .eq("mailbox_id", mailboxId)
    .maybeSingle();
  if (error) throw error;
  if (!thread) throw new AuthError("Thread not found.", 404);

  const { data: messages } = await client
    .from("email_messages")
    .select("id, text_body, from_address, to_addresses, created_at, direction")
    .eq("thread_id", threadId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1);

  const latest = messages?.[0];
  let hasAttachments = false;
  if (latest) {
    const { count } = await client
      .from("email_attachments")
      .select("id", { count: "exact", head: true })
      .eq("message_id", latest.id);
    hasAttachments = (count ?? 0) > 0;
  }

  return {
    subject: String(thread.subject ?? "(no subject)"),
    stewardMeta: (thread.steward_meta as Record<string, unknown>) ?? {},
    dealId: thread.deal_id ? String(thread.deal_id) : null,
    assignedEmployeeId: thread.assigned_employee_id
      ? String(thread.assigned_employee_id)
      : null,
    latestMessage: latest
      ? {
          id: String(latest.id),
          textBody: latest.text_body ? String(latest.text_body) : null,
          fromAddress: latest.from_address ? String(latest.from_address) : null,
          toAddresses: Array.isArray(latest.to_addresses)
            ? (latest.to_addresses as string[])
            : [],
          createdAt: String(latest.created_at),
          hasAttachments,
        }
      : null,
  };
}

export async function buildContextForThread(
  base: Omit<WorkActionBase, "clientActionId" | "userName" | "access"> & {
    access?: InboxAccess;
  },
): Promise<EmailWorkContext> {
  const src = await loadThreadWorkSource(
    base.client,
    base.workspaceId,
    base.mailboxId,
    base.threadId,
  );
  const participants = [
    src.latestMessage?.fromAddress,
    ...(src.latestMessage?.toAddresses ?? []),
  ].filter(Boolean) as string[];
  const keyPoints = Array.isArray(src.stewardMeta.keyPoints)
    ? (src.stewardMeta.keyPoints as string[])
    : [];
  const summary =
    typeof src.stewardMeta.summary === "string" ? src.stewardMeta.summary : null;
  const summaryVersion =
    typeof src.stewardMeta.summaryVersion === "string"
      ? src.stewardMeta.summaryVersion
      : src.latestMessage?.id ?? null;

  return buildEmailWorkContext({
    emailThreadId: base.threadId,
    latestMessageId: src.latestMessage?.id ?? base.threadId,
    subject: src.subject,
    externalParticipants: participants,
    stewardSummary: summary,
    keyPoints,
    latestTextBody: src.latestMessage?.textBody,
    hasAttachments: src.latestMessage?.hasAttachments,
    sourceSnapshotAt: src.latestMessage?.createdAt ?? nowISO(),
    sourceSummaryVersion: summaryVersion,
  });
}

async function withIdempotency<T extends Record<string, unknown>>(
  base: WorkActionBase,
  actionType: string,
  run: () => Promise<T>,
): Promise<T & { replayed?: boolean }> {
  if (!base.clientActionId?.trim()) {
    throw new AuthError("clientActionId required", 400);
  }
  const existing = await findWorkAction(base.client, {
    workspaceId: base.workspaceId,
    clientActionId: base.clientActionId,
  });
  if (existing?.status === "completed") {
    return { ...(existing.resultPayload as T), replayed: true };
  }
  await assertInboxWorkOrganize(base.access);
  const result = await run();
  await completeWorkAction(base.client, {
    workspaceId: base.workspaceId,
    mailboxId: base.mailboxId,
    threadId: base.threadId,
    clientActionId: base.clientActionId,
    actionType,
    actorUserId: base.userId,
    resultPayload: result,
  });
  await recordEmailEvent(base.client, {
    workspaceId: base.workspaceId,
    mailboxId: base.mailboxId,
    threadId: base.threadId,
    actorType: "human",
    actorId: base.userId,
    eventType: `email.work_${actionType}`,
    payload: { clientActionId: base.clientActionId, ...result },
  });
  return result;
}

async function seedBridgeMessage(
  base: WorkActionBase,
  roomId: string,
  topicId: string,
  ctx: EmailWorkContext,
): Promise<string> {
  const content = formatEmailWorkBridgeMessage(ctx);
  const msg = await insertHumanMessage(
    base.client,
    base.workspaceId,
    roomId,
    { id: base.userId, name: base.userName },
    content,
    topicId,
    `email-bridge-${base.clientActionId}`,
  );
  return msg.id;
}

function employeeStubFromRow(row: Record<string, unknown>): AIEmployee {
  return {
    id: String(row.id),
    name: String(row.name ?? "Employee"),
    role: String(row.role ?? ""),
    roleKey: (row.role_key as AIEmployee["roleKey"]) ?? "operations",
    provider: String(row.provider ?? "siliconflow"),
    model: String(row.model ?? ""),
    modelMode: (row.model_mode as AIEmployee["modelMode"]) ?? "balanced",
    seniority: String(row.seniority ?? ""),
    status: (row.status as AIEmployee["status"]) ?? "online",
    instructions: String(row.instructions ?? ""),
    communicationStyle: String(row.communication_style ?? ""),
    successCriteria: String(row.success_criteria ?? ""),
    tools: [],
    permissions: {} as AIEmployee["permissions"],
    memoryCount: 0,
    tasksCompleted: 0,
    messagesSent: 0,
    approvalsRequested: 0,
    avgResponseTime: "-",
    trustScore: 75,
    accent: String(row.accent ?? "#2f6fed"),
    lastActiveAt: nowISO(),
    createdAt: nowISO(),
    isSystemEmployee: Boolean(row.is_system_employee),
    systemEmployeeKey: row.system_employee_key
      ? String(row.system_employee_key)
      : null,
  };
}

// --- D1 actions ----------------------------------------------------------------

export async function startRoomFromEmail(
  base: WorkActionBase,
  params?: { roomName?: string },
) {
  return withIdempotency(base, "start_room", async () => {
    await assertCanCreateRoom(base.client, {
      workspaceId: base.workspaceId,
      userId: base.userId,
    });
    const ctx = await buildContextForThread(base);
    const provenance = provenanceFromContext(ctx);
    const roomId = uid("room");
    const name =
      params?.roomName?.trim() ||
      truncateName(`Email · ${ctx.subject}`, 80);
    const now = nowISO();

    const { error: roomError } = await base.client.from("rooms").insert({
      workspace_id: base.workspaceId,
      id: roomId,
      name,
      kind: "room",
      description: `Started from inbox thread`,
      brief: ctx.stewardSummary ?? "",
      unread: 0,
      accent: "#2f6fed",
      status: "active",
      created_at: now,
      updated_at: now,
    });
    if (roomError) throw roomError;

    await base.client.from("room_members").upsert(
      {
        workspace_id: base.workspaceId,
        room_id: roomId,
        member_type: "human",
        member_id: base.userId,
        created_at: now,
      },
      { onConflict: "workspace_id,room_id,member_type,member_id" },
    );

    const topic = await ensureGeneralTopic(base.client, base.workspaceId, roomId);
    const messageId = await seedBridgeMessage(base, roomId, topic.id, ctx);
    const edge = await upsertWorkGraphEdge(base.client, {
      workspaceId: base.workspaceId,
      fromObjectType: "email_thread",
      fromObjectId: base.threadId,
      relationType: EMAIL_WORK_RELATIONS.spawnedRoom,
      toObjectType: "room",
      toObjectId: roomId,
      metadata: { ...provenance, topicId: topic.id, messageId },
    });
    await upsertWorkGraphEdge(base.client, {
      workspaceId: base.workspaceId,
      fromObjectType: "email_thread",
      fromObjectId: base.threadId,
      relationType: EMAIL_WORK_RELATIONS.linkedTopic,
      toObjectType: "topic",
      toObjectId: topic.id,
      metadata: { ...provenance, roomId },
    });

    return {
      roomId,
      topicId: topic.id,
      messageId,
      edgeId: edge.id,
      provenance,
      roomName: name,
    };
  });
}

export async function linkRoomFromEmail(
  base: WorkActionBase,
  params: { roomId: string; seedBridge?: boolean },
) {
  return withIdempotency(base, "link_room", async () => {
    await assertCanBridgeIntoRoom(base.client, {
      workspaceId: base.workspaceId,
      roomId: params.roomId,
      userId: base.userId,
    });
    const ctx = await buildContextForThread(base);
    const provenance = provenanceFromContext(ctx);
    const topic = await ensureGeneralTopic(
      base.client,
      base.workspaceId,
      params.roomId,
    );
    let messageId: string | null = null;
    if (params.seedBridge !== false) {
      messageId = await seedBridgeMessage(base, params.roomId, topic.id, ctx);
    }
    const edge = await upsertWorkGraphEdge(base.client, {
      workspaceId: base.workspaceId,
      fromObjectType: "email_thread",
      fromObjectId: base.threadId,
      relationType: EMAIL_WORK_RELATIONS.linkedRoom,
      toObjectType: "room",
      toObjectId: params.roomId,
      metadata: { ...provenance, topicId: topic.id, messageId },
    });
    return {
      roomId: params.roomId,
      topicId: topic.id,
      messageId,
      edgeId: edge.id,
      provenance,
    };
  });
}

export async function linkTopicFromEmail(
  base: WorkActionBase,
  params: { roomId: string; topicId?: string; topicTitle?: string },
) {
  return withIdempotency(base, "link_topic", async () => {
    await assertCanBridgeIntoRoom(base.client, {
      workspaceId: base.workspaceId,
      roomId: params.roomId,
      userId: base.userId,
    });
    const ctx = await buildContextForThread(base);
    const provenance = provenanceFromContext(ctx);

    let topicId = params.topicId;
    if (!topicId) {
      const title = params.topicTitle?.trim() || truncateName(ctx.subject, 60);
      const { data: created, error } = await base.client
        .from("topics")
        .insert({
          workspace_id: base.workspaceId,
          room_id: params.roomId,
          title,
          description: "Linked from workspace inbox",
          created_by_type: "human",
          created_by_id: base.userId,
          metadata: { fromInboxThreadId: base.threadId },
        })
        .select("id")
        .single();
      if (error) throw error;
      topicId = String(created.id);
      await base.client.from("topic_members").upsert(
        {
          workspace_id: base.workspaceId,
          room_id: params.roomId,
          topic_id: topicId,
          member_type: "human",
          member_id: base.userId,
          role: "owner",
        },
        { onConflict: "topic_id,member_type,member_id" },
      );
    }

    const messageId = await seedBridgeMessage(base, params.roomId, topicId, ctx);
    await upsertWorkGraphEdge(base.client, {
      workspaceId: base.workspaceId,
      fromObjectType: "email_thread",
      fromObjectId: base.threadId,
      relationType: EMAIL_WORK_RELATIONS.linkedRoom,
      toObjectType: "room",
      toObjectId: params.roomId,
      metadata: provenance,
    });
    const edge = await upsertWorkGraphEdge(base.client, {
      workspaceId: base.workspaceId,
      fromObjectType: "email_thread",
      fromObjectId: base.threadId,
      relationType: EMAIL_WORK_RELATIONS.linkedTopic,
      toObjectType: "topic",
      toObjectId: topicId,
      metadata: { ...provenance, roomId: params.roomId, messageId },
    });
    return {
      roomId: params.roomId,
      topicId,
      messageId,
      edgeId: edge.id,
      provenance,
    };
  });
}

export async function createTaskFromEmail(
  base: WorkActionBase,
  params: {
    roomId: string;
    topicId?: string;
    title: string;
    description?: string;
    assigneeEmployeeId?: string | null;
  },
) {
  return withIdempotency(base, "create_task", async () => {
    await assertCanBridgeIntoRoom(base.client, {
      workspaceId: base.workspaceId,
      roomId: params.roomId,
      userId: base.userId,
    });
    const ctx = await buildContextForThread(base);
    const provenance = provenanceFromContext(ctx);
    const topicId =
      params.topicId ??
      (await ensureGeneralTopic(base.client, base.workspaceId, params.roomId)).id;

    let assigneeId: string | null = null;
    let assigneeType: string | null = null;
    if (params.assigneeEmployeeId) {
      const emp = await loadWorkAssignableEmployee(base.client, {
        workspaceId: base.workspaceId,
        employeeId: params.assigneeEmployeeId,
      });
      assigneeId = emp.id;
      assigneeType = "ai";
      await base.client.from("room_members").upsert(
        {
          workspace_id: base.workspaceId,
          room_id: params.roomId,
          member_type: "ai",
          member_id: emp.id,
          created_at: nowISO(),
        },
        { onConflict: "workspace_id,room_id,member_type,member_id" },
      );
    }

    const taskId = uid("task");
    const now = nowISO();
    const { error } = await base.client.from("tasks").insert({
      workspace_id: base.workspaceId,
      id: taskId,
      room_id: params.roomId,
      topic_id: topicId,
      title: params.title.trim(),
      description: params.description?.trim() || ctx.stewardSummary || null,
      status: "open",
      priority: "medium",
      assignee_type: assigneeType,
      assignee_id: assigneeId,
      created_from: "inbox_thread",
      created_by_run_id: null,
      due_date: null,
      created_at: now,
      updated_at: now,
    });
    if (error) throw error;

    const edge = await upsertWorkGraphEdge(base.client, {
      workspaceId: base.workspaceId,
      fromObjectType: "email_thread",
      fromObjectId: base.threadId,
      relationType: EMAIL_WORK_RELATIONS.linkedTask,
      toObjectType: "task",
      toObjectId: taskId,
      metadata: {
        ...provenance,
        roomId: params.roomId,
        topicId,
        title: params.title.trim(),
        assigneeEmployeeId: assigneeId,
      },
    });

    return {
      taskId,
      roomId: params.roomId,
      topicId,
      edgeId: edge.id,
      title: params.title.trim(),
      provenance,
      assigneeEmployeeId: assigneeId,
    };
  });
}

// --- D2 actions ----------------------------------------------------------------

export async function askEmployeeFromEmail(
  base: WorkActionBase,
  params: {
    employeeId: string;
    /** dm | room — when room, roomId required */
    target: "dm" | "room";
    roomId?: string;
    topicId?: string;
    /** Work Hours event type for the queued run (AI paths only). */
    workType?: "email_ask_employee" | "email_prepare_proposal";
  },
) {
  return withIdempotency(base, "ask_employee", async () => {
    const empMeta = await loadWorkAssignableEmployee(base.client, {
      workspaceId: base.workspaceId,
      employeeId: params.employeeId,
    });
    const { data: empRow, error: empErr } = await base.client
      .from("ai_employees")
      .select("*")
      .eq("workspace_id", base.workspaceId)
      .eq("id", params.employeeId)
      .single();
    if (empErr || !empRow) throw empErr ?? new AuthError("Employee not found", 404);
    const employee = employeeStubFromRow(empRow as Record<string, unknown>);
    if (isMayaEmployee(employee)) {
      throw new AuthError("Maya cannot be asked to do inbox work.", 400);
    }

    const ctx = await buildContextForThread(base);
    const provenance = provenanceFromContext(ctx);
    let roomId = params.roomId;
    let topicId = params.topicId;

    if (params.target === "dm") {
      roomId = `dm-${params.employeeId}`;
      const { data: existingDm } = await base.client
        .from("rooms")
        .select("id")
        .eq("workspace_id", base.workspaceId)
        .eq("kind", "dm")
        .eq("dm_employee_id", params.employeeId)
        .maybeSingle();
      if (existingDm) {
        roomId = String(existingDm.id);
      } else {
        const now = nowISO();
        await base.client.from("rooms").insert({
          workspace_id: base.workspaceId,
          id: roomId,
          name: empMeta.name,
          kind: "dm",
          dm_employee_id: params.employeeId,
          description: "",
          brief: "",
          unread: 0,
          accent: "#2f6fed",
          status: "active",
          created_at: now,
          updated_at: now,
        });
        await base.client.from("room_members").upsert(
          [
            {
              workspace_id: base.workspaceId,
              room_id: roomId,
              member_type: "human",
              member_id: base.userId,
              created_at: now,
            },
            {
              workspace_id: base.workspaceId,
              room_id: roomId,
              member_type: "ai",
              member_id: params.employeeId,
              created_at: now,
            },
          ],
          { onConflict: "workspace_id,room_id,member_type,member_id" },
        );
      }
    } else {
      if (!roomId) throw new AuthError("roomId required when target is room", 400);
      await assertCanBridgeIntoRoom(base.client, {
        workspaceId: base.workspaceId,
        roomId,
        userId: base.userId,
      });
      await base.client.from("room_members").upsert(
        {
          workspace_id: base.workspaceId,
          room_id: roomId,
          member_type: "ai",
          member_id: params.employeeId,
          created_at: nowISO(),
        },
        { onConflict: "workspace_id,room_id,member_type,member_id" },
      );
    }

    const topic =
      topicId != null
        ? { id: topicId }
        : await ensureGeneralTopic(base.client, base.workspaceId, roomId!);
    topicId = topic.id;

    const bridge = formatEmailWorkBridgeMessage(ctx);
    const content = `${bridge}\n\n@${empMeta.name} — please help with this email. This is an internal work request only; do not send external email.`;
    const message = await insertHumanMessage(
      base.client,
      base.workspaceId,
      roomId!,
      { id: base.userId, name: base.userName },
      content,
      topicId,
      `email-ask-${base.clientActionId}`,
    );

    const { queued, blocked } = await queueAgentRuns(base.client, {
      workspaceId: base.workspaceId,
      roomId: roomId!,
      topicId,
      triggerMessageId: message.id,
      responders: [
        {
          employee,
          reason: "explicit_mention",
          runMetadata: {
            workType: params.workType ?? "email_ask_employee",
            emailThreadId: base.threadId,
            emailMessageId: ctx.latestMessageId,
            ...provenance,
          },
        },
      ],
      content,
    });

    const workHoursEvent = params.workType ?? "email_ask_employee";
    return {
      roomId: roomId!,
      topicId,
      messageId: message.id,
      employeeId: params.employeeId,
      employeeName: empMeta.name,
      queuedRuns: queued.map((q) => q.runId),
      blocked,
      provenance,
      workHoursEvent,
    };
  });
}

export async function createProposalWorkspace(
  base: WorkActionBase,
  params: { roomId: string; topicId?: string; title?: string },
) {
  return withIdempotency(base, "create_proposal", async () => {
    await assertCanBridgeIntoRoom(base.client, {
      workspaceId: base.workspaceId,
      roomId: params.roomId,
      userId: base.userId,
    });
    const ctx = await buildContextForThread(base);
    const provenance = provenanceFromContext(ctx);
    const topicId =
      params.topicId ??
      (await ensureGeneralTopic(base.client, base.workspaceId, params.roomId)).id;
    const artifactId = crypto.randomUUID();
    const title =
      params.title?.trim() || `Proposal: ${truncateName(ctx.subject, 60)}`;
    const contentMarkdown = [
      `# ${title}`,
      ``,
      `_Placeholder proposal workspace created from inbox._`,
      ``,
      `## Source`,
      `- Thread: ${ctx.inboxDeepLink}`,
      `- Snapshot: ${ctx.sourceSnapshotAt}`,
      ``,
      `## Notes`,
      ctx.stewardSummary ?? "_Add proposal content or prepare with AI._",
    ].join("\n");

    const { error } = await base.client.from("artifacts").insert({
      workspace_id: base.workspaceId,
      id: artifactId,
      room_id: params.roomId,
      topic_id: topicId,
      title,
      artifact_type: "proposal",
      status: "draft",
      content_markdown: contentMarkdown,
      content_json: { provenance, emailWorkContext: ctx, ready: false },
      created_by_type: "human",
      created_by_id: base.userId,
      source_file_ids: [],
      source_message_ids: [],
      source_chunk_ids: [],
      source_citations: [],
    });
    if (error) throw error;
    await base.client.from("artifact_versions").insert({
      artifact_id: artifactId,
      version_number: 1,
      content_markdown: contentMarkdown,
      content_json: { provenance },
      source_citations: [],
      created_by_type: "human",
      created_by_id: base.userId,
    });

    const edge = await upsertWorkGraphEdge(base.client, {
      workspaceId: base.workspaceId,
      fromObjectType: "email_thread",
      fromObjectId: base.threadId,
      relationType: EMAIL_WORK_RELATIONS.linkedArtifact,
      toObjectType: "artifact",
      toObjectId: artifactId,
      metadata: { ...provenance, artifactType: "proposal", roomId: params.roomId, topicId },
    });

    return {
      artifactId,
      roomId: params.roomId,
      topicId,
      edgeId: edge.id,
      title,
      provenance,
    };
  });
}

export async function prepareProposalWithAi(
  base: WorkActionBase,
  params: {
    employeeId: string;
    roomId: string;
    topicId?: string;
    artifactId?: string;
  },
) {
  return withIdempotency(base, "prepare_proposal", async () => {
    let artifactId = params.artifactId;
    if (!artifactId) {
      const created = await createProposalWorkspace(
        {
          ...base,
          clientActionId: `${base.clientActionId}:workspace`,
        },
        { roomId: params.roomId, topicId: params.topicId },
      );
      artifactId = created.artifactId as string;
    }

    const ask = await askEmployeeFromEmail(
      {
        ...base,
        clientActionId: `${base.clientActionId}:ask`,
      },
      {
        employeeId: params.employeeId,
        target: "room",
        roomId: params.roomId,
        topicId: params.topicId,
        workType: "email_prepare_proposal",
      },
    );

    // Update artifact metadata to mark AI prepare queued
    await base.client
      .from("artifacts")
      .update({
        content_json: {
          ready: false,
          preparing: true,
          workType: "email_prepare_proposal",
          agentRunIds: ask.queuedRuns,
        },
        updated_at: nowISO(),
      })
      .eq("id", artifactId)
      .eq("workspace_id", base.workspaceId);

    return {
      artifactId,
      ...ask,
      workHoursEvent: "email_prepare_proposal" as const,
    };
  });
}

export async function saveDecisionFromEmail(
  base: WorkActionBase,
  params: {
    roomId: string;
    topicId?: string;
    decisionStatement: string;
    rationale: string;
    ownerName?: string;
    decisionDate?: string;
    alternatives?: string;
    consequences?: string;
  },
) {
  return withIdempotency(base, "save_decision", async () => {
    await assertCanBridgeIntoRoom(base.client, {
      workspaceId: base.workspaceId,
      roomId: params.roomId,
      userId: base.userId,
    });
    const ctx = await buildContextForThread(base);
    const provenance = provenanceFromContext(ctx);
    const topicId =
      params.topicId ??
      (await ensureGeneralTopic(base.client, base.workspaceId, params.roomId)).id;
    const artifactId = crypto.randomUUID();
    const title = `Decision: ${truncateName(params.decisionStatement, 60)}`;
    const contentMarkdown = [
      `# ${title}`,
      ``,
      `**Decision:** ${params.decisionStatement.trim()}`,
      ``,
      `**Rationale:** ${params.rationale.trim()}`,
      ``,
      `**Owner:** ${params.ownerName?.trim() || base.userName}`,
      `**Date:** ${params.decisionDate?.trim() || nowISO().slice(0, 10)}`,
      params.alternatives?.trim()
        ? `\n**Alternatives considered:**\n${params.alternatives.trim()}`
        : "",
      params.consequences?.trim()
        ? `\n**Consequences:**\n${params.consequences.trim()}`
        : "",
      ``,
      `## Source email`,
      `- ${ctx.inboxDeepLink}`,
      `- Snapshot: ${ctx.sourceSnapshotAt}`,
    ]
      .filter(Boolean)
      .join("\n");

    const { error } = await base.client.from("artifacts").insert({
      workspace_id: base.workspaceId,
      id: artifactId,
      room_id: params.roomId,
      topic_id: topicId,
      title,
      artifact_type: "decision",
      status: "final",
      content_markdown: contentMarkdown,
      content_json: {
        decisionStatement: params.decisionStatement.trim(),
        rationale: params.rationale.trim(),
        owner: params.ownerName?.trim() || base.userName,
        decisionDate: params.decisionDate?.trim() || nowISO().slice(0, 10),
        alternatives: params.alternatives?.trim() || null,
        consequences: params.consequences?.trim() || null,
        provenance,
      },
      created_by_type: "human",
      created_by_id: base.userId,
      source_file_ids: [],
      source_message_ids: [],
      source_chunk_ids: [],
      source_citations: [],
    });
    if (error) throw error;
    await base.client.from("artifact_versions").insert({
      artifact_id: artifactId,
      version_number: 1,
      content_markdown: contentMarkdown,
      content_json: { provenance },
      source_citations: [],
      created_by_type: "human",
      created_by_id: base.userId,
    });

    const edge = await upsertWorkGraphEdge(base.client, {
      workspaceId: base.workspaceId,
      fromObjectType: "email_thread",
      fromObjectId: base.threadId,
      relationType: EMAIL_WORK_RELATIONS.linkedArtifact,
      toObjectType: "artifact",
      toObjectId: artifactId,
      metadata: { ...provenance, artifactType: "decision", roomId: params.roomId, topicId },
    });

    return {
      artifactId,
      roomId: params.roomId,
      topicId,
      edgeId: edge.id,
      title,
      provenance,
      suggestedMemoryFact: truncateName(params.decisionStatement.trim(), 160),
    };
  });
}

// --- D3 actions ----------------------------------------------------------------

export async function attachDealFromEmail(
  base: WorkActionBase,
  params: { dealId: string },
) {
  return withIdempotency(base, "attach_deal", async () => {
    const { data: deal, error } = await base.client
      .from("crm_deals")
      .select("id, name")
      .eq("workspace_id", base.workspaceId)
      .eq("id", params.dealId)
      .maybeSingle();
    if (error) throw error;
    if (!deal) throw new AuthError("Deal not found.", 404);

    await base.client
      .from("email_threads")
      .update({ deal_id: params.dealId })
      .eq("id", base.threadId)
      .eq("workspace_id", base.workspaceId);

    const ctx = await buildContextForThread(base);
    const provenance = provenanceFromContext(ctx);
    const edge = await upsertWorkGraphEdge(base.client, {
      workspaceId: base.workspaceId,
      fromObjectType: "email_thread",
      fromObjectId: base.threadId,
      relationType: EMAIL_WORK_RELATIONS.linkedDeal,
      toObjectType: "crm_deal",
      toObjectId: params.dealId,
      metadata: {
        ...provenance,
        dealName: String(deal.name ?? "Deal"),
      },
    });

    return {
      dealId: params.dealId,
      dealName: String(deal.name ?? "Deal"),
      edgeId: edge.id,
      provenance,
    };
  });
}

export async function saveMemoryFromEmail(
  base: WorkActionBase,
  params: {
    title: string;
    content: string;
    roomId?: string | null;
    confidence?: number;
  },
) {
  return withIdempotency(base, "save_memory", async () => {
    const ctx = await buildContextForThread(base);
    const provenance = provenanceFromContext(ctx);
    const memoryId = memoryUid("mem");
    const now = nowISO();
    const roomId = params.roomId ?? null;
    const { dedupeKey, existing } = await resolveMemoryInsert(base.client, base.workspaceId, {
      workspaceId: base.workspaceId,
      scope: roomId ? "room" : "workspace",
      roomId: roomId ?? undefined,
      topicId: null,
      title: params.title.trim(),
      content: params.content.trim(),
    });

    if (existing) {
      const edge = await upsertWorkGraphEdge(base.client, {
        workspaceId: base.workspaceId,
        fromObjectType: "email_message",
        fromObjectId: ctx.latestMessageId,
        relationType: EMAIL_WORK_RELATIONS.sourcesMemory,
        toObjectType: "memory_entry",
        toObjectId: existing.id,
        metadata: { ...provenance, threadId: base.threadId },
      });
      return {
        memoryId: existing.id,
        duplicate: true,
        edgeId: edge.id,
        provenance,
      };
    }

    const { error } = await base.client.from("memory_entries").insert({
      workspace_id: base.workspaceId,
      id: memoryId,
      room_id: roomId,
      topic_id: null,
      type: "note",
      title: params.title.trim(),
      content: params.content.trim(),
      status: "approved",
      created_by_type: "human",
      created_by_id: base.userId,
      created_by_run_id: null,
      scope: roomId ? "room" : "workspace",
      category: "Other",
      tags: ["email"],
      source_type: "manual",
      source_message_id: null,
      source_object_type: "email_message",
      source_object_id: ctx.latestMessageId,
      source_thread_id: base.threadId,
      source_excerpt: ctx.excerpt,
      source_received_at: ctx.sourceSnapshotAt,
      external_sender: ctx.externalParticipants[0] ?? null,
      reviewed_by_user_id: base.userId,
      confidence: params.confidence ?? 0.8,
      saved_by_user_id: base.userId,
      dedupe_key: dedupeKey,
      metadata: { provenance },
      created_at: now,
      updated_at: now,
    });
    if (error) throw error;

    const edge = await upsertWorkGraphEdge(base.client, {
      workspaceId: base.workspaceId,
      fromObjectType: "email_message",
      fromObjectId: ctx.latestMessageId,
      relationType: EMAIL_WORK_RELATIONS.sourcesMemory,
      toObjectType: "memory_entry",
      toObjectId: memoryId,
      metadata: { ...provenance, threadId: base.threadId },
    });

    return {
      memoryId,
      duplicate: false,
      edgeId: edge.id,
      provenance,
    };
  });
}

export async function unlinkEmailWork(
  base: WorkActionBase,
  params: { edgeId: string },
) {
  return withIdempotency(base, "unlink", async () => {
    const edge = await unlinkWorkGraphEdge(base.client, {
      workspaceId: base.workspaceId,
      edgeId: params.edgeId,
      unlinkedBy: base.userId,
    });
    if (!edge) throw new AuthError("Edge not found or already unlinked.", 404);
    return { edgeId: edge.id, unlinked: true };
  });
}

// --- Context read --------------------------------------------------------------

export type LinkedWorkItem = {
  edgeId: string;
  relationType: string;
  objectType: string;
  objectId: string;
  title: string;
  href: string | null;
  provenance: EmailWorkProvenance | null;
  stale: boolean;
  meta: Record<string, unknown>;
};

export async function getEmailThreadWorkContext(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    mailboxId: string;
    threadId: string;
  },
): Promise<{
  workContext: EmailWorkContext;
  linkedWork: LinkedWorkItem[];
  recommendedAction: {
    kind: "create_task" | "start_room" | "save_memory" | "none";
    label: string;
    detail: string;
  };
  dealId: string | null;
  keyPointSuggestions: string[];
}> {
  const src = await loadThreadWorkSource(
    client,
    params.workspaceId,
    params.mailboxId,
    params.threadId,
  );
  const workContext = await buildContextForThread({
    client,
    workspaceId: params.workspaceId,
    mailboxId: params.mailboxId,
    threadId: params.threadId,
    userId: "",
  });

  const edges = await listActiveEdgesForThread(client, {
    workspaceId: params.workspaceId,
    threadId: params.threadId,
  });

  const latestInboundAt = src.latestMessage?.createdAt
    ? new Date(src.latestMessage.createdAt).getTime()
    : 0;

  const linkedWork: LinkedWorkItem[] = [];
  for (const edge of edges) {
    const meta = edge.metadata;
    const snap =
      typeof meta.sourceSnapshotAt === "string"
        ? new Date(meta.sourceSnapshotAt).getTime()
        : 0;
    const stale = latestInboundAt > 0 && snap > 0 && latestInboundAt > snap + 1000;
    const hydrated = await hydrateLinkedObject(client, params.workspaceId, edge);
    linkedWork.push({
      edgeId: edge.id,
      relationType: edge.relationType,
      objectType: edge.toObjectType,
      objectId: edge.toObjectId,
      title: hydrated.title,
      href: hydrated.href,
      provenance:
        typeof meta.sourceEmailThreadId === "string"
          ? {
              sourceEmailThreadId: String(meta.sourceEmailThreadId),
              sourceEmailMessageId: String(meta.sourceEmailMessageId ?? ""),
              sourceSnapshotAt: String(meta.sourceSnapshotAt ?? ""),
              sourceSummaryVersion:
                typeof meta.sourceSummaryVersion === "string"
                  ? meta.sourceSummaryVersion
                  : null,
            }
          : null,
      stale,
      meta,
    });
  }

  const suggested =
    typeof src.stewardMeta.suggestedNextAction === "string"
      ? src.stewardMeta.suggestedNextAction
      : null;
  const hasTask = linkedWork.some((l) => l.objectType === "task");
  const hasRoom = linkedWork.some(
    (l) => l.relationType === "spawned_room" || l.relationType === "linked_room",
  );

  let recommendedAction: {
    kind: "create_task" | "start_room" | "save_memory" | "none";
    label: string;
    detail: string;
  } = { kind: "none", label: "No suggested action", detail: "" };

  if (!hasTask && suggested) {
    recommendedAction = {
      kind: "create_task",
      label: "Create task",
      detail: suggested,
    };
  } else if (!hasRoom) {
    recommendedAction = {
      kind: "start_room",
      label: "Start a room",
      detail: "Turn this email into a project room with a privacy-safe bridge.",
    };
  } else if (workContext.keyPoints.length > 0) {
    recommendedAction = {
      kind: "save_memory",
      label: "Save important facts",
      detail: "Review key points and save durable facts to memory.",
    };
  }

  return {
    workContext,
    linkedWork,
    recommendedAction,
    dealId: src.dealId,
    keyPointSuggestions: workContext.keyPoints,
  };
}

async function hydrateLinkedObject(
  client: SupabaseClient,
  workspaceId: string,
  edge: WorkGraphEdgeRow,
): Promise<{ title: string; href: string | null }> {
  const metaTitle =
    typeof edge.metadata.title === "string"
      ? edge.metadata.title
      : typeof edge.metadata.dealName === "string"
        ? edge.metadata.dealName
        : null;

  switch (edge.toObjectType) {
    case "room": {
      const { data } = await client
        .from("rooms")
        .select("name")
        .eq("workspace_id", workspaceId)
        .eq("id", edge.toObjectId)
        .maybeSingle();
      return {
        title: data?.name ? String(data.name) : metaTitle ?? "Room",
        href: `/rooms/${edge.toObjectId}`,
      };
    }
    case "topic": {
      const { data } = await client
        .from("topics")
        .select("title, room_id")
        .eq("workspace_id", workspaceId)
        .eq("id", edge.toObjectId)
        .maybeSingle();
      return {
        title: data?.title ? String(data.title) : metaTitle ?? "Topic",
        href: data?.room_id
          ? `/rooms/${data.room_id}?topic=${edge.toObjectId}`
          : null,
      };
    }
    case "task": {
      const { data } = await client
        .from("tasks")
        .select("title, room_id")
        .eq("workspace_id", workspaceId)
        .eq("id", edge.toObjectId)
        .maybeSingle();
      return {
        title: data?.title ? String(data.title) : metaTitle ?? "Task",
        href: data?.room_id ? `/rooms/${data.room_id}` : "/tasks",
      };
    }
    case "artifact": {
      const { data } = await client
        .from("artifacts")
        .select("title, room_id")
        .eq("workspace_id", workspaceId)
        .eq("id", edge.toObjectId)
        .maybeSingle();
      return {
        title: data?.title ? String(data.title) : metaTitle ?? "Artifact",
        href: data?.room_id ? `/rooms/${data.room_id}` : null,
      };
    }
    case "crm_deal": {
      return {
        title: metaTitle ?? "Deal",
        href: "/crm",
      };
    }
    case "memory_entry": {
      const { data } = await client
        .from("memory_entries")
        .select("title")
        .eq("workspace_id", workspaceId)
        .eq("id", edge.toObjectId)
        .maybeSingle();
      return {
        title: data?.title ? String(data.title) : "Memory",
        href: "/memory",
      };
    }
    default:
      return { title: metaTitle ?? edge.toObjectType, href: null };
  }
}

function truncateName(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}
