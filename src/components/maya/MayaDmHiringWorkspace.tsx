"use client";

import { MayaDmHiringChat } from "@/components/maya/MayaDmHiringChat";
import { MayaDmHiringProvider } from "@/components/maya/MayaDmHiringContext";
import { MayaHiringPanel } from "@/components/maya/MayaHiringPanel";

type MayaDmHiringLayoutProps = {
  mayaRoomId: string;
  mayaTopicId?: string;
  firstName?: string;
};

/**
 * Maya DM hiring: chat in the center column, live job brief + candidates in the
 * page right column (lg+). On smaller screens the brief stacks below the chat.
 */
export function MayaDmHiringLayout({
  mayaRoomId,
  mayaTopicId,
  firstName,
}: MayaDmHiringLayoutProps) {
  return (
    <MayaDmHiringProvider mayaRoomId={mayaRoomId} mayaTopicId={mayaTopicId}>
      <div className="flex min-h-0 w-full flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border bg-canvas">
          <MayaDmHiringChat firstName={firstName} />
          <div className="flex h-[min(42vh,360px)] min-h-0 shrink-0 flex-col border-t border-border lg:hidden">
            <MayaHiringPanel />
          </div>
        </div>
        <div className="hidden h-full min-h-0 w-[344px] shrink-0 lg:block">
          <MayaHiringPanel />
        </div>
      </div>
    </MayaDmHiringProvider>
  );
}
