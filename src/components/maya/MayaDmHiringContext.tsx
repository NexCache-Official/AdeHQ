"use client";

import { createContext, useContext } from "react";
import { useMayaDmHiring } from "@/components/maya/useMayaDmHiring";

type MayaDmHiringValue = ReturnType<typeof useMayaDmHiring>;

const MayaDmHiringContext = createContext<MayaDmHiringValue | null>(null);

export function MayaDmHiringProvider({
  mayaRoomId,
  mayaTopicId,
  children,
}: {
  mayaRoomId: string;
  mayaTopicId?: string;
  children: React.ReactNode;
}) {
  const hiring = useMayaDmHiring({ mayaRoomId, mayaTopicId });
  return (
    <MayaDmHiringContext.Provider value={hiring}>{children}</MayaDmHiringContext.Provider>
  );
}

export function useMayaDmHiringContext() {
  const ctx = useContext(MayaDmHiringContext);
  if (!ctx) {
    throw new Error("useMayaDmHiringContext must be used within MayaDmHiringProvider");
  }
  return ctx;
}
