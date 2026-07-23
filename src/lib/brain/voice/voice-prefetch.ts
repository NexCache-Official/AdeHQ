/**
 * PR-18.2A10 — Interim transcript prefetch.
 * Use partial STT for routing/prefetch only — never start the LLM early.
 */

import { routeVoiceBrainTurn } from "./voice-brain-router";
import {
  getVoiceSessionSnapshot,
  type VoiceSessionSnapshot,
} from "./voice-session-snapshot";

export type VoicePrefetchState = {
  callId: string;
  partialText: string;
  predictedRoute: ReturnType<typeof routeVoiceBrainTurn>["route"];
  reason: string;
  updatedAt: number;
  snapshotWarm: boolean;
};

const prefetchByCall = new Map<string, VoicePrefetchState>();

export function prefetchFromInterimTranscript(input: {
  callId: string;
  partialText: string;
  snapshot?: VoiceSessionSnapshot | null;
}): VoicePrefetchState | null {
  const text = input.partialText.trim();
  if (text.length < 8) return null;
  // Avoid thrashing on every phoneme — update when the partial grows materially.
  const prior = prefetchByCall.get(input.callId);
  if (prior && text.length - prior.partialText.length < 6 && text.startsWith(prior.partialText)) {
    return prior;
  }

  const snapshot = input.snapshot ?? getVoiceSessionSnapshot(input.callId);
  const decision = routeVoiceBrainTurn({
    message: text,
    snapshot,
  });

  const state: VoicePrefetchState = {
    callId: input.callId,
    partialText: text,
    predictedRoute: decision.route,
    reason: decision.reason,
    updatedAt: Date.now(),
    snapshotWarm: Boolean(snapshot),
  };
  prefetchByCall.set(input.callId, state);
  return state;
}

export function getVoicePrefetchState(callId: string): VoicePrefetchState | null {
  return prefetchByCall.get(callId) ?? null;
}

export function clearVoicePrefetchState(callId: string): void {
  prefetchByCall.delete(callId);
}
