"use client";

import { useRouter } from "next/navigation";
import {
  MAYA_EMPLOYEE_NAME,
  MAYA_EMPLOYEE_SUBTITLE,
  MAYA_WORKFORCE_BADGE,
  mayaOnboardingWelcomeMessage,
  mayaWelcomeMessage,
} from "@/lib/hiring/maya";
import { readOnboardingContext } from "@/lib/hiring/data";
import { AdeOrb } from "@/components/hiring/HireChrome";

const MAYA_CONTEXT_KEY = "maya_employee_context";
const ONBOARDING_WELCOME_KEY = "adehq:maya-onboarding-welcome";

export function storeMayaEmployeeContext(payload: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(MAYA_CONTEXT_KEY, JSON.stringify(payload));
}

export function readMayaEmployeeContext<T>(): T | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(MAYA_CONTEXT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function consumeOnboardingWelcome(): string | null {
  if (typeof window === "undefined") return null;
  const stored = sessionStorage.getItem(ONBOARDING_WELCOME_KEY);
  if (stored) {
    sessionStorage.removeItem(ONBOARDING_WELCOME_KEY);
    return stored;
  }
  const context = readOnboardingContext();
  if (context?.setupComplete) {
    return mayaOnboardingWelcomeMessage(
      "there",
      "your workspace",
      context.roomName,
      context.suggestedHires[0],
    );
  }
  return null;
}

type MayaDmEmptyStateProps = {
  firstName?: string;
  welcomeOverride?: string | null;
  onSendMessage?: (text: string) => void;
};

export function MayaDmEmptyState({
  firstName = "there",
  welcomeOverride,
  onSendMessage,
}: MayaDmEmptyStateProps) {
  const router = useRouter();
  const context = readOnboardingContext();
  const welcome =
    welcomeOverride ??
    (context?.setupComplete
      ? mayaOnboardingWelcomeMessage(
          firstName,
          "your workspace",
          context.roomName,
          context.suggestedHires[0],
        )
      : mayaWelcomeMessage(firstName));

  const chips = context?.setupComplete
    ? [
        { id: "hire-analyst", label: "Help me hire", message: "I need to hire a Market Research Analyst." },
        { id: "guide", label: "Explain AdeHQ", message: "Walk me through how AdeHQ works and what I should do first." },
        { id: "improve", label: "Improve an employee", intent: "improve_employee" as const },
        { id: "room", label: "Create a room", message: "Help me create a new room for my team." },
        { id: "workforce", label: "Review my workforce", message: "Review my current AI workforce and suggest improvements." },
        { id: "next", label: "What should I do next?", message: "What should I focus on next in AdeHQ?" },
      ]
    : [
        { id: "hire", label: "Help me hire", message: "I need to hire an AI employee — help me choose a role." },
        { id: "guide", label: "Explain AdeHQ", message: "Walk me through how AdeHQ works and what I should do first." },
        { id: "improve", label: "Improve an employee", intent: "improve_employee" as const },
        { id: "room", label: "Create a room", message: "Help me create a new room for my team." },
        { id: "workforce", label: "Review my workforce", message: "Review my current AI workforce and suggest improvements." },
        { id: "next", label: "What should I do next?", message: "What should I focus on next in AdeHQ?" },
      ];

  const handleAction = (action: { href?: string; message?: string; intent?: string; label: string }) => {
    if ("href" in action && action.href) {
      router.push(action.href);
      return;
    }
    if ("message" in action && action.message) {
      onSendMessage?.(action.message);
      return;
    }
    if ("intent" in action) {
      onSendMessage?.(
        action.intent === "improve_employee"
          ? "I want to improve an existing AI employee."
          : "Help me rewrite an employee job brief.",
      );
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col items-center px-2 py-6 text-center sm:py-8">
      <AdeOrb size={56} initials="M" />
      <div className="mt-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-ink">{MAYA_EMPLOYEE_NAME}</h2>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-ink-2">
          {MAYA_WORKFORCE_BADGE}
        </span>
      </div>
      <p className="text-sm text-ink-2">{MAYA_EMPLOYEE_SUBTITLE}</p>
      <p className="mt-4 max-w-md text-[13px] leading-relaxed text-ink-2">
        Ask Maya how AdeHQ works, who to hire, how to organize rooms, or how to improve your AI workforce.
      </p>
      <p className="mt-4 whitespace-pre-line text-left text-[14px] leading-relaxed text-ink-2">
        {welcome}
      </p>
      <div className="mt-6 flex w-full flex-wrap justify-center gap-2">
        {chips.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => handleAction(action)}
            className="rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-2 transition hover:border-ink/30 hover:text-ink"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
