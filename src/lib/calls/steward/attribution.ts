export type SpeakerAttributionMethod =
  | "native_track_identity"
  | "multichannel"
  | "diarization"
  | "unknown";

export type KnownSpeakerTrack = {
  participantId: string;
  providerSessionId?: string | null;
  trackName?: string | null;
  channel?: number | null;
};

export type SpeakerAttributionRequest = {
  providerSessionId?: string | null;
  trackName?: string | null;
  channel?: number | null;
  mixedExternalAudio?: boolean;
  knownTracks: KnownSpeakerTrack[];
  providerLimits?: {
    maxInputChannels?: number;
  };
};

export type SpeakerAttribution = {
  participantId: string | null;
  method: SpeakerAttributionMethod;
  confidence: "high" | "medium" | "low";
  requiresDiarization: boolean;
};

/**
 * Attribution is ordered by information quality. Provider-native WebRTC
 * identity is authoritative; channel identity is used only within provider
 * limits; diarization is reserved for an otherwise unknown mixed input.
 */
export function resolveSpeakerAttribution(
  request: SpeakerAttributionRequest,
): SpeakerAttribution {
  const native = request.knownTracks.find(
    (track) =>
      request.providerSessionId &&
      track.providerSessionId === request.providerSessionId &&
      (!request.trackName || !track.trackName || track.trackName === request.trackName),
  );
  if (native) {
    return {
      participantId: native.participantId,
      method: "native_track_identity",
      confidence: "high",
      requiresDiarization: false,
    };
  }

  const maxChannels = Math.max(0, request.providerLimits?.maxInputChannels ?? 0);
  if (
    request.channel != null &&
    request.channel >= 0 &&
    request.channel < maxChannels
  ) {
    const channel = request.knownTracks.find((track) => track.channel === request.channel);
    if (channel) {
      return {
        participantId: channel.participantId,
        method: "multichannel",
        confidence: "high",
        requiresDiarization: false,
      };
    }
  }

  if (request.mixedExternalAudio) {
    return {
      participantId: null,
      method: "diarization",
      confidence: "low",
      requiresDiarization: true,
    };
  }

  return {
    participantId: null,
    method: "unknown",
    confidence: "low",
    requiresDiarization: false,
  };
}

export type AttributionPlan = {
  sharedSttStreamCount: 1;
  perAiListeningStreams: 0;
  nativeTrackCount: number;
  multichannelTrackCount: number;
  requiresDiarization: boolean;
};

export function buildAttributionPlan(input: {
  tracks: KnownSpeakerTrack[];
  providerMaxInputChannels: number;
  hasUnknownMixedExternalAudio?: boolean;
}): AttributionPlan {
  const nativeTrackCount = input.tracks.filter(
    (track) => track.providerSessionId && track.trackName,
  ).length;
  const multichannelTrackCount = Math.min(
    Math.max(0, input.providerMaxInputChannels),
    input.tracks.filter((track) => track.channel != null).length,
  );
  return {
    sharedSttStreamCount: 1,
    perAiListeningStreams: 0,
    nativeTrackCount,
    multichannelTrackCount,
    requiresDiarization:
      Boolean(input.hasUnknownMixedExternalAudio) &&
      nativeTrackCount === 0 &&
      multichannelTrackCount === 0,
  };
}
