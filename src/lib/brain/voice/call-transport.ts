import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientCallEvent, ServerCallEvent } from "./live-types";

export type AudioFrame = {
  sequence: number;
  pcm: Uint8Array;
  capturedAt: number;
};

export type CreateCallTransportInput = {
  callSessionId: string;
  sessionToken: string;
};

export interface CallTransportSession {
  readonly id: string;
  readonly events: AsyncIterable<ServerCallEvent>;
}

export interface CallTransport {
  createSession(input: CreateCallTransportInput): Promise<CallTransportSession>;
  sendAudio(frame: AudioFrame): Promise<void>;
  sendEvent(event: ClientCallEvent): Promise<void>;
  close(reason: string): Promise<void>;
}

export type ActiveCallLease = {
  callId: string;
  connectionId: string;
  playbackSequence: number;
  interruptedAt?: string;
  expiresAt: string;
};

/**
 * Redis-ready transient coordination contract. The alpha implementation stores
 * only tiny lease metadata on the durable call row; audio and partial captions
 * are never written to Supabase.
 */
export interface CallTransientCoordinator {
  claim(callId: string, connectionId: string, ttlSeconds: number): Promise<void>;
  heartbeat(callId: string, connectionId: string, ttlSeconds: number): Promise<void>;
  setPlaybackSequence(callId: string, sequence: number): Promise<void>;
  signalInterrupt(callId: string): Promise<void>;
  release(callId: string, connectionId: string): Promise<void>;
}

export class SupabaseCallTransientCoordinator implements CallTransientCoordinator {
  constructor(
    private readonly client: SupabaseClient,
    private readonly workspaceId: string,
  ) {}

  async claim(callId: string, connectionId: string, ttlSeconds: number): Promise<void> {
    await this.patch(callId, {
      connectionId,
      playbackSequence: 0,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    });
  }

  async heartbeat(
    callId: string,
    connectionId: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.patch(callId, {
      connectionId,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    });
  }

  async setPlaybackSequence(callId: string, sequence: number): Promise<void> {
    await this.patch(callId, { playbackSequence: sequence });
  }

  async signalInterrupt(callId: string): Promise<void> {
    await this.patch(callId, { interruptedAt: new Date().toISOString() });
  }

  async release(callId: string, connectionId: string): Promise<void> {
    await this.patch(callId, {
      connectionId,
      releasedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    });
  }

  private async patch(callId: string, transient: Record<string, unknown>): Promise<void> {
    const { data, error } = await this.client
      .from("calls")
      .select("metadata")
      .eq("workspace_id", this.workspaceId)
      .eq("id", callId)
      .maybeSingle();
    if (error) throw error;
    const metadata =
      data?.metadata && typeof data.metadata === "object"
        ? (data.metadata as Record<string, unknown>)
        : {};
    const { error: updateError } = await this.client
      .from("calls")
      .update({
        metadata: { ...metadata, transient },
        last_activity_at: new Date().toISOString(),
      })
      .eq("workspace_id", this.workspaceId)
      .eq("id", callId);
    if (updateError) throw updateError;
  }
}
