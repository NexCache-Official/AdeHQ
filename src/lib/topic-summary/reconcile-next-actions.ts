import type { TopicSummaryNextAction } from "./types";

type TaskLike = { id?: string; title: string; status: string };

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "about",
  "follow",
  "task",
  "open",
  "existing",
]);

export function normalizeNextActionTitle(title: string): string {
  return title
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/[^\w\s]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .join(" ")
    .trim();
}

export function nextActionTitlesAreSimilar(a: string, b: string): boolean {
  const left = normalizeNextActionTitle(a);
  const right = normalizeNextActionTitle(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const leftWords = new Set(left.split(" ").filter(Boolean));
  const rightWords = right.split(" ").filter(Boolean);
  if (!rightWords.length) return false;

  const overlap = rightWords.filter((word) => leftWords.has(word)).length;
  return overlap / rightWords.length >= 0.72;
}

export function isOpenTaskStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized !== "done" && normalized !== "completed" && normalized !== "cancelled";
}

export function findMatchingOpenTask(
  actionTitle: string,
  tasks: TaskLike[],
): TaskLike | null {
  for (const task of tasks) {
    if (!isOpenTaskStatus(task.status)) continue;
    if (nextActionTitlesAreSimilar(actionTitle, task.title)) return task;
  }
  return null;
}

export function dedupeTopicSummaryNextActions(
  actions: TopicSummaryNextAction[],
): TopicSummaryNextAction[] {
  const kept: TopicSummaryNextAction[] = [];
  for (const action of actions) {
    const title = action.title?.trim();
    if (!title) continue;
    const duplicate = kept.some((existing) => nextActionTitlesAreSimilar(existing.title, title));
    if (!duplicate) kept.push(action);
  }
  return kept;
}

export function filterNextActionsAgainstOpenTasks(
  actions: TopicSummaryNextAction[],
  tasks: TaskLike[],
): TopicSummaryNextAction[] {
  return actions.filter((action) => !findMatchingOpenTask(action.title, tasks));
}

export function reconcileTopicSummaryNextActions(
  actions: TopicSummaryNextAction[],
  tasks: TaskLike[],
): TopicSummaryNextAction[] {
  const deduped = dedupeTopicSummaryNextActions(actions);
  return filterNextActionsAgainstOpenTasks(deduped, tasks);
}
