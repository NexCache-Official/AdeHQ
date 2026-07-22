"use client";

import { useEffect, useRef, useState } from "react";
import type { CallSessionSummary } from "@/lib/calls/types";
import { useDirectP2PCall } from "./useDirectP2PCall";
import { useHumanSfuCall } from "./useHumanSfuCall";

function eligibleForP2P(call: CallSessionSummary | null) {
  return (
    process.env.NEXT_PUBLIC_ADEHQ_P2P_CALLS_V1 === "1" &&
    call?.kind === "human_human" &&
    call.privacyMode === "human_private" &&
    !call.videoEnabled &&
    call.participants.length === 2 &&
    call.participants.every((participant) => participant.participantType === "human")
  );
}

export function useHumanCallMedia(params: {
  call: CallSessionSummary | null;
  userId: string;
  onEnded?: () => void;
}) {
  const p2p = useDirectP2PCall(params);
  const sfu = useHumanSfuCall(params);
  const [forceSfu, setForceSfu] = useState(false);
  const topology = eligibleForP2P(params.call) && !forceSfu ? "p2p" : "sfu";
  const previousTopology = useRef(topology);

  useEffect(() => {
    setForceSfu(false);
  }, [params.call?.id]);

  useEffect(() => {
    if (topology === "p2p" && p2p.phase === "failed") setForceSfu(true);
  }, [p2p.phase, topology]);

  useEffect(() => {
    if (previousTopology.current === topology) return;
    if (previousTopology.current === "p2p" && topology === "sfu") {
      p2p.closeOnly();
      void sfu.connect();
    }
    previousTopology.current = topology;
  }, [p2p.closeOnly, sfu.connect, topology]);

  return {
    ...(topology === "p2p" ? p2p : sfu),
    topology,
    migrateToSfu: () => setForceSfu(true),
  };
}
