export type FloorRequest = {
  turnId: string;
  employeeId: string;
  priority: number;
  requestedAt: number;
  dedupeKey: string;
};

export type AiFloorSpeaker = FloorRequest & {
  startedAt: number;
};

export type CallFloorState = {
  humanSpeakerIds: string[];
  aiSpeaker: AiFloorSpeaker | null;
  queue: FloorRequest[];
  recentDedupeKeys: Array<{ key: string; seenAt: number }>;
};

export type FloorDisposition =
  | "granted"
  | "queued"
  | "duplicate"
  | "interrupted"
  | "released"
  | "unchanged";

export type FloorResult = {
  state: CallFloorState;
  disposition: FloorDisposition;
  interruptedTurnId?: string;
  grantedTurnId?: string;
};

const DEFAULT_DEDUPE_WINDOW_MS = 30_000;

export function createFloorState(): CallFloorState {
  return {
    humanSpeakerIds: [],
    aiSpeaker: null,
    queue: [],
    recentDedupeKeys: [],
  };
}

function compactDedupe(
  entries: CallFloorState["recentDedupeKeys"],
  now: number,
  windowMs: number,
) {
  return entries.filter((entry) => now - entry.seenAt <= windowMs);
}

function sortQueue(queue: FloorRequest[]) {
  return [...queue].sort(
    (left, right) => right.priority - left.priority || left.requestedAt - right.requestedAt,
  );
}

function grantNext(state: CallFloorState, now: number): FloorResult {
  if (state.humanSpeakerIds.length || state.aiSpeaker || !state.queue.length) {
    return { state, disposition: "unchanged" };
  }
  const [next, ...queue] = sortQueue(state.queue);
  return {
    state: {
      ...state,
      queue,
      aiSpeaker: { ...next, startedAt: now },
    },
    disposition: "granted",
    grantedTurnId: next.turnId,
  };
}

export function requestAiFloor(
  state: CallFloorState,
  request: FloorRequest,
  options?: { dedupeWindowMs?: number },
): FloorResult {
  const windowMs = options?.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const recentDedupeKeys = compactDedupe(state.recentDedupeKeys, request.requestedAt, windowMs);
  if (
    recentDedupeKeys.some((entry) => entry.key === request.dedupeKey) ||
    state.aiSpeaker?.dedupeKey === request.dedupeKey ||
    state.queue.some((queued) => queued.dedupeKey === request.dedupeKey)
  ) {
    return {
      state: { ...state, recentDedupeKeys },
      disposition: "duplicate",
    };
  }

  const nextState: CallFloorState = {
    ...state,
    recentDedupeKeys: [
      ...recentDedupeKeys,
      { key: request.dedupeKey, seenAt: request.requestedAt },
    ],
  };
  if (!state.humanSpeakerIds.length && !state.aiSpeaker) {
    return {
      state: {
        ...nextState,
        aiSpeaker: { ...request, startedAt: request.requestedAt },
      },
      disposition: "granted",
      grantedTurnId: request.turnId,
    };
  }
  return {
    state: { ...nextState, queue: sortQueue([...state.queue, request]) },
    disposition: "queued",
  };
}

export function humanStartedSpeaking(
  state: CallFloorState,
  participantId: string,
): FloorResult {
  const interruptedTurnId = state.aiSpeaker?.turnId;
  return {
    state: {
      ...state,
      humanSpeakerIds: [...new Set([...state.humanSpeakerIds, participantId])],
      aiSpeaker: null,
    },
    disposition: interruptedTurnId ? "interrupted" : "unchanged",
    interruptedTurnId,
  };
}

export function humanStoppedSpeaking(
  state: CallFloorState,
  participantId: string,
  now: number,
): FloorResult {
  const nextState = {
    ...state,
    humanSpeakerIds: state.humanSpeakerIds.filter((id) => id !== participantId),
  };
  return grantNext(nextState, now);
}

export function releaseAiFloor(
  state: CallFloorState,
  turnId: string,
  now: number,
): FloorResult {
  if (state.aiSpeaker?.turnId !== turnId) {
    return { state, disposition: "unchanged" };
  }
  const next = grantNext({ ...state, aiSpeaker: null }, now);
  return next.disposition === "granted"
    ? next
    : { ...next, disposition: "released" };
}

export function removeQueuedAiTurn(
  state: CallFloorState,
  turnId: string,
): CallFloorState {
  return {
    ...state,
    queue: state.queue.filter((request) => request.turnId !== turnId),
  };
}
