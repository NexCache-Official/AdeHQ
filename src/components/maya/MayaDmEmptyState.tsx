"use client";

import { useRouter } from "next/navigation";
import { MAYA_DM_QUICK_ACTIONS, MAYA_EMPLOYEE_NAME, MAYA_EMPLOYEE_TITLE, MAYA_WORKFORCE_BADGE, mayaWelcomeMessage } from "@/lib/hiring/maya";
import { AdeOrb } from "@/components/hiring/HireChrome";

const MAYA_CONTEXT_KEY = "maya_employee_context";

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

type MayaDmEmptyStateProps = {
  firstName?: string;
  onSendMessage?: (text: string) => void;
};

export function MayaDmEmptyState({ firstName = "there", onSendMessage }: MayaDmEmptyStateProps) {
  const router = useRouter();
  const welcome = mayaWelcomeMessage(firstName);

  const handleAction = (action: (typeof MAYA_DM_QUICK_ACTIONS)[number]) => {
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
    <div className="mx-auto flex max-w-[560px] flex-col items-center px-4 py-10 text-center">
      <AdeOrb size={56} initials="M" />
      <div className="mt-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-ink">{MAYA_EMPLOYEE_NAME}</h2>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-ink-2">
          {MAYA_WORKFORCE_BADGE}
        </span>
      </div>
      <p className="text-sm text-ink-2">{MAYA_EMPLOYEE_TITLE}</p>
      <p className="mt-5 whitespace-pre-line text-left text-[14px] leading-relaxed text-ink-2">
        {welcome}
      </p>
      <div className="mt-6 flex w-full flex-wrap justify-center gap-2">
        {MAYA_DM_QUICK_ACTIONS.map((action) => (
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
