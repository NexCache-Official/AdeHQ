"use client";

import { useState } from "react";
import { Modal, ModalHeader } from "@/components/ui";
import { AutonomousSessionPanel } from "./AutonomousSessionPanel";
import { Bot } from "lucide-react";

/** Inline chat chip that opens the live autopilot session panel. */
export function AutonomousSessionChip({ sessionId, label }: { sessionId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent-soft/60 px-2.5 py-1.5 text-xs font-medium text-accent-d transition-colors hover:bg-accent-soft"
      >
        <Bot className="h-3.5 w-3.5" />
        {label ?? "Autopilot session"}
        <span className="text-[10px] text-accent/70">· view</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} size="lg">
        <ModalHeader title="Autopilot" onClose={() => setOpen(false)} icon={<Bot className="h-5 w-5" />} />
        <div className="p-4">
          <AutonomousSessionPanel sessionId={sessionId} />
        </div>
      </Modal>
    </>
  );
}
