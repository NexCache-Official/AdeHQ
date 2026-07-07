import {
  dedupeTopicSummaryNextActions,
  filterNextActionsAgainstOpenTasks,
  nextActionTitlesAreSimilar,
  reconcileTopicSummaryNextActions,
} from "../src/lib/topic-summary/reconcile-next-actions";

const existingTask = {
  id: "task-1",
  title: "Follow up with Robert Green re Frontline Electricals",
  status: "open",
};

const duplicateActions = [
  {
    title:
      "Follow up with Robert Green re Frontline Electricals (existing open task). Execute outreach per drafted email and advance deal stage if appropriate.",
    status: "Planned" as const,
  },
  {
    title:
      "Follow up with Robert Green re Frontline Electricals (existing open task). Execute outreach per drafted email and advance deal stage if appropriate.",
    status: "Planned" as const,
  },
];

if (!nextActionTitlesAreSimilar(duplicateActions[0].title, existingTask.title)) {
  throw new Error("expected follow-up action to match existing task title");
}

const deduped = dedupeTopicSummaryNextActions(duplicateActions);
if (deduped.length !== 1) {
  throw new Error(`expected one deduped action, got ${deduped.length}`);
}

const filtered = filterNextActionsAgainstOpenTasks(deduped, [existingTask]);
if (filtered.length !== 0) {
  throw new Error("expected matching open task to remove next action");
}

const reconciled = reconcileTopicSummaryNextActions(duplicateActions, [existingTask]);
if (reconciled.length !== 0) {
  throw new Error("expected reconcile to clear duplicate actions for existing task");
}

const kept = reconcileTopicSummaryNextActions(
  [
    { title: "Draft investor update deck", status: "Planned" },
    { title: "Draft investor update deck for Q3", status: "Planned" },
  ],
  [],
);
if (kept.length !== 1) {
  throw new Error(`expected similar titles to dedupe, got ${kept.length}`);
}

console.log("All next-action reconcile tests passed.");
