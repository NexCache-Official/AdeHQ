import { NextRequest } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { artifactFromRow } from "@/lib/files/records";
import type { SavedArtifact } from "@/lib/types";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Pure access decision for artifact scope (no DB).
 * Encodes private-DM inheritance: workspace membership alone is never enough
 * for artifacts attached to a private DM room — the viewer must be a room
 * participant (or the creator).
 */
export type ArtifactScopeAccessInput = {
  isWorkspaceMember: boolean;
  isArtifactCreator: boolean;
  roomId: string | null;
  /** True when the artifact's room is a private AI/human DM. */
  isPrivateDmRoom: boolean;
  /** Viewer participates in the room (member or AI grant). */
  isRoomParticipant: boolean;
  /** Optional playbook/artifact share scope override. */
  shareScope?: "private" | "room" | "workspace";
};

export function canViewArtifactScope(input: ArtifactScopeAccessInput): boolean {
  if (input.isArtifactCreator) return true;
  if (!input.isWorkspaceMember) return false;

  const shareScope =
    input.shareScope ?? (input.roomId ? "room" : "workspace");

  if (shareScope === "private") {
    return false;
  }

  if (input.roomId) {
    // Private DM inheritance: non-participants in the same workspace cannot view.
    if (input.isPrivateDmRoom) {
      return input.isRoomParticipant;
    }
    return input.isRoomParticipant;
  }

  return shareScope === "workspace";
}

export async function loadAccessibleArtifact(
  request: NextRequest,
  artifactId: string,
): Promise<{
  user: User;
  client: SupabaseClient;
  artifact: SavedArtifact;
  role: string;
}> {
  const { user, client } = await requireAuthUser(request);
  const { data, error } = await client
    .from("artifacts")
    .select("*")
    .eq("id", artifactId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthError("Artifact not found.", 404);

  const artifact = artifactFromRow(data as Record<string, unknown>);
  const { role } = await requireWorkspaceMembership(client, artifact.workspaceId, user.id);
  if (artifact.roomId) {
    await assertCanAccessRoom(client, artifact.workspaceId, artifact.roomId, user.id, role);
  }
  return { user, client, artifact, role };
}
