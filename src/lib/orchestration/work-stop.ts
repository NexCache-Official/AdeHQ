export type WorkStopTarget = "search" | "browser" | "task" | "all";

export type WorkStopDetection = {
  isStop: boolean;
  target: WorkStopTarget;
  reason: string;
};

const STOP_VERBS =
  /\b(stop|cancel|abort|halt|kill|end|quit|never mind|nevermind|forget it|stand down|hold on)\b/i;

const SEARCH_TARGETS =
  /\b(search|research|lookup|look up|browse|browsing|browser|scanning|scraping)\b/i;

const BROWSER_TARGETS = /\b(browser|browse live|live browse|browsing live|screenshot)\b/i;

const TASK_TARGETS = /\b(task|work|job|run|agent mode|working on)\b/i;

/** Detect when the user wants to interrupt active AI work. */
export function detectWorkStopRequest(message: string): WorkStopDetection {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 280) {
    return { isStop: false, target: "all", reason: "not_stop" };
  }

  const hasStopVerb = STOP_VERBS.test(trimmed);
  const mentionsSearch = SEARCH_TARGETS.test(trimmed);
  const mentionsBrowser = BROWSER_TARGETS.test(trimmed);
  const mentionsTask = TASK_TARGETS.test(trimmed);

  const imperativeStop =
    /^(stop|cancel|abort|halt)\b/i.test(trimmed) ||
    /\b(stop (the|this|that)|cancel (the|this|that))\b/i.test(trimmed);

  if (!hasStopVerb && !imperativeStop) {
    return { isStop: false, target: "all", reason: "not_stop" };
  }

  if (mentionsBrowser || /\bstop browsing\b/i.test(trimmed)) {
    return { isStop: true, target: "browser", reason: "User asked to stop browser/live research." };
  }

  if (mentionsSearch || /\bstop (the )?search\b/i.test(trimmed)) {
    return { isStop: true, target: "search", reason: "User asked to stop search/research." };
  }

  if (mentionsTask) {
    return { isStop: true, target: "task", reason: "User asked to stop active task work." };
  }

  return { isStop: true, target: "all", reason: "User asked to stop current work." };
}

export type WorkStopAckInput = {
  employeeName: string;
  cancelledBrowserResearchCount: number;
  cancelledAgentRunCount: number;
};

export function buildWorkStopAcknowledgment(input: WorkStopAckInput): string {
  const { cancelledBrowserResearchCount, cancelledAgentRunCount } = input;

  if (cancelledBrowserResearchCount > 0 && cancelledAgentRunCount > 0) {
    return "Got it — I've stopped the live search and cancelled what I was working on. Let me know if you want to pick this up again.";
  }

  if (cancelledBrowserResearchCount > 0) {
    return "Got it — I've stopped the live search. Say the word if you want me to look something up again.";
  }

  if (cancelledAgentRunCount > 0) {
    return "Got it — stopping. Let me know if you need anything else.";
  }

  return "Nothing was actively running on my side, but I'm here if you need anything.";
}
