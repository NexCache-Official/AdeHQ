"use client";

import Link from "next/link";
import { Modal, ModalHeader, Button } from "@/components/ui";
import { canStartCheckout } from "@/lib/workspace/permissions";
import { Timer } from "lucide-react";

export function UpgradeModal({
  open,
  onClose,
  role,
  exhausted = false,
}: {
  open: boolean;
  onClose: () => void;
  role: string | null | undefined;
  exhausted?: boolean;
}) {
  const canUpgrade = canStartCheckout(role);

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <ModalHeader
        title={exhausted ? "AI Work Hours used up" : "AI Work Hours running low"}
        subtitle="Human messaging always continues."
        onClose={onClose}
        icon={<Timer className="h-5 w-5" />}
      />
      <div className="space-y-4 px-6 py-5 text-sm text-ink-2">
        <p>
          {exhausted
            ? "Your AI employees are paused because this workspace has used its weekly AI Work Hours."
            : "This workspace is close to using all of its weekly AI Work Hours. AI employees may pause soon."}
          {" "}
          {canUpgrade
            ? "Upgrade for more weekly AI work capacity, or wait until the weekly reset."
            : "Ask a workspace admin to upgrade, or wait until the weekly reset."}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Wait until reset
          </Button>
          {canUpgrade && (
            <Link href="/settings/billing" onClick={onClose}>
              <Button size="sm">View plans</Button>
            </Link>
          )}
        </div>
      </div>
    </Modal>
  );
}
