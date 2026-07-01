"use client";

import { useState } from "react";
import { MayaDmHiringChat } from "@/components/maya/MayaDmHiringChat";
import { MayaDmHiringProvider } from "@/components/maya/MayaDmHiringContext";
import { MayaHiringPanel } from "@/components/maya/MayaHiringPanel";
import { FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

type MayaDmHiringLayoutProps = {
  mayaRoomId: string;
  mayaTopicId?: string;
  firstName?: string;
};

/**
 * Maya DM hiring: chat fills the center; job brief + candidates stay in a
 * dedicated right column (md+). On small screens the brief opens in a sheet.
 */
export function MayaDmHiringLayout({
  mayaRoomId,
  mayaTopicId,
  firstName,
}: MayaDmHiringLayoutProps) {
  const [mobileBriefOpen, setMobileBriefOpen] = useState(false);

  return (
    <MayaDmHiringProvider mayaRoomId={mayaRoomId} mayaTopicId={mayaTopicId}>
      <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
        {/* Chat column — fixed height, messages scroll inside RecruiterChat */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
          <MayaDmHiringChat firstName={firstName} className="h-full min-h-0 flex-1" />

          {/* Mobile: open brief sheet (never stack brief below chat) */}
          <button
            type="button"
            onClick={() => setMobileBriefOpen(true)}
            className="absolute bottom-[5.5rem] right-4 z-10 flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-xs font-medium text-ink shadow-md md:hidden"
          >
            <FileText className="h-3.5 w-3.5" />
            Job brief
          </button>
        </div>

        {/* Desktop / tablet: persistent right column */}
        <aside className="hidden h-full min-h-0 w-[min(400px,34vw)] shrink-0 flex-col overflow-hidden border-l border-border bg-surface md:flex">
          <MayaHiringPanel />
        </aside>
      </div>

      {/* Mobile brief sheet */}
      {mobileBriefOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close job brief"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setMobileBriefOpen(false)}
          />
          <div
            className={cn(
              "absolute inset-y-0 right-0 flex w-[min(100%,420px)] flex-col bg-surface shadow-xl",
              "animate-in slide-in-from-right duration-200",
            )}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold text-ink">Job brief</span>
              <button
                type="button"
                onClick={() => setMobileBriefOpen(false)}
                className="rounded-lg p-1.5 text-ink-3 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <MayaHiringPanel />
            </div>
          </div>
        </div>
      )}
    </MayaDmHiringProvider>
  );
}
