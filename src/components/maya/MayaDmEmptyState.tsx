"use client";

import { useRouter } from "next/navigation";
import {
  MAYA_DM_QUICK_ACTIONS,
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
        { id: "hire-analyst", label: "Hire a Market Research Analyst", message: "I need to hire a Market Research Analyst." },
        { id: "hire-sdr", label: "Hire a Sales Development Representative", message: "I need to hire a Sales Development Representative." },
        { id: "hire-engineer", label: "Hire a Software Engineer", message: "I need to hire a Software Engineer." },
        { id: "role", label: "Not sure — help me decide", message: "I'm not sure what role I need — can you recommend one based on my goals?" },
        { id: "browse", label: "Browse popular roles", message: "Show me popular roles I could hire for this workspace." },
      ]
    : MAYA_DM_QUICK_ACTIONS;

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
      <p className="mt-5 whitespace-pre-line text-left text-[14px] leading-relaxed text-ink-2">
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
