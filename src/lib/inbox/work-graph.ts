/**
 * Work Graph helpers for inbox → platform links.
 * Upsert active edges; unlink tombstones for audit. No assigned_owner mirrors.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const EMAIL_WORK_RELATIONS = {
  spawnedRoom: "spawned_room",
  linkedRoom: "linked_room",
  linkedTopic: "linked_topic",
  linkedTask: "linked_task",
  linkedArtifact: "linked_artifact",
  sourcesMemory: "sources_memory",
  linkedDeal: "linked_deal",
  linkedContact: "linked_contact",
} as const;

export type EmailWorkRelation =
  (typeof EMAIL_WORK_RELATIONS)[keyof typeof EMAIL_WORK_RELATIONS];

export type WorkGraphEdgeRow = {
  id: string;
  workspaceId: string;
  fromObjectType: string;
  fromObjectId: string;
  relationType: string;
  toObjectType: string;
  toObjectId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  unlinkedAt: string | null;
};

function mapEdge(row: Record<string, unknown>): WorkGraphEdgeRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    fromObjectType: String(row.from_object_type),
    fromObjectId: String(row.from_object_id),
    relationType: String(row.relation_type),
    toObjectType: String(row.to_object_type),
    toObjectId: String(row.to_object_id),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
    unlinkedAt: row.unlinked_at ? String(row.unlinked_at) : null,
  };
}

/** Upsert one active edge; returns existing if already present. */
export async function upsertWorkGraphEdge(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    fromObjectType: string;
    fromObjectId: string;
    relationType: string;
    toObjectType: string;
    toObjectId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<WorkGraphEdgeRow> {
  const now = new Date().toISOString();
  const { data: existing, error: findError } = await client
    .from("work_graph_edges")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("from_object_type", params.fromObjectType)
    .eq("from_object_id", params.fromObjectId)
    .eq("to_object_type", params.toObjectType)
    .eq("to_object_id", params.toObjectId)
    .eq("relation_type", params.relationType)
    .is("unlinked_at", null)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const merged = {
      ...((existing.metadata as Record<string, unknown>) ?? {}),
      ...(params.metadata ?? {}),
    };
    const { data: updated, error: updateError } = await client
      .from("work_graph_edges")
      .update({ metadata: merged, updated_at: now })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (updateError) throw updateError;
    return mapEdge(updated as Record<string, unknown>);
  }

  // Re-activate tombstoned identical edge if present.
  const { data: tombstoned } = await client
    .from("work_graph_edges")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("from_object_type", params.fromObjectType)
    .eq("from_object_id", params.fromObjectId)
    .eq("to_object_type", params.toObjectType)
    .eq("to_object_id", params.toObjectId)
    .eq("relation_type", params.relationType)
    .not("unlinked_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tombstoned) {
    const { data: revived, error: reviveError } = await client
      .from("work_graph_edges")
      .update({
        unlinked_at: null,
        unlinked_by: null,
        metadata: params.metadata ?? {},
        updated_at: now,
      })
      .eq("id", tombstoned.id)
      .select("*")
      .single();
    if (reviveError) throw reviveError;
    return mapEdge(revived as Record<string, unknown>);
  }

  const { data: inserted, error: insertError } = await client
    .from("work_graph_edges")
    .insert({
      workspace_id: params.workspaceId,
      from_object_type: params.fromObjectType,
      from_object_id: params.fromObjectId,
      relation_type: params.relationType,
      to_object_type: params.toObjectType,
      to_object_id: params.toObjectId,
      metadata: params.metadata ?? {},
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return mapEdge(inserted as Record<string, unknown>);
}

export async function unlinkWorkGraphEdge(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    edgeId: string;
    unlinkedBy: string;
  },
): Promise<WorkGraphEdgeRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("work_graph_edges")
    .update({
      unlinked_at: now,
      unlinked_by: params.unlinkedBy,
      updated_at: now,
    })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.edgeId)
    .is("unlinked_at", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? mapEdge(data as Record<string, unknown>) : null;
}

export async function listActiveEdgesForThread(
  client: SupabaseClient,
  params: { workspaceId: string; threadId: string },
): Promise<WorkGraphEdgeRow[]> {
  const { data, error } = await client
    .from("work_graph_edges")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("from_object_type", "email_thread")
    .eq("from_object_id", params.threadId)
    .is("unlinked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapEdge(row as Record<string, unknown>));
}
