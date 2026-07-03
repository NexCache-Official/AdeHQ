"use client";

import {
  Sparkles,
  UserPlus,
  Wand2,
  FolderPlus,
  Users,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

export type MayaQuickAction = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  message: string;
};

const QUICK_ACTIONS: MayaQuickAction[] = [
  {
    id: "ask",
    label: "Ask Maya",
    description: "Questions about your workforce or workspace",
    icon: Sparkles,
    message: "What can you help me with?",
  },
  {
    id: "hire",
    label: "Hire an employee",
    description: "Start a guided hiring session",
    icon: UserPlus,
    message: "I want to hire an AI employee — help me choose a role.",
  },
  {
    id: "improve",
    label: "Improve an employee",
    description: "Refine an existing hire's brief",
    icon: Wand2,
    message: "I want to improve an existing AI employee.",
  },
  {
    id: "room",
    label: "Create a room",
    description: "Organize a new space for your team",
    icon: FolderPlus,
    message: "Help me create a new room for my team.",
  },
  {
    id: "workforce",
    label: "Review workforce",
    description: "See and improve your current hires",
    icon: Users,
    message: "Review my current AI workforce and suggest improvements.",
  },
  {
    id: "help",
    label: "How AdeHQ works",
    description: "Learn the basics of the platform",
    icon: HelpCircle,
    message: "Walk me through how AdeHQ works and what I should do first.",
  },
];

type MayaQuickActionsPanelProps = {
  onAction: (message: string) => void;
  disabled?: boolean;
};

export function MayaQuickActionsPanel({ onAction, disabled = false }: MayaQuickActionsPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Workforce manager
        </div>
        <div className="mt-1 text-sm font-medium text-ink">What can Maya do?</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              disabled={disabled}
              onClick={() => onAction(action.message)}
              className="flex items-start gap-3 rounded-xl border border-border bg-canvas px-3 py-2.5 text-left transition hover:border-ink/30 disabled:opacity-50"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-2">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{action.label}</span>
                <span className="block text-xs leading-snug text-ink-3">{action.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
