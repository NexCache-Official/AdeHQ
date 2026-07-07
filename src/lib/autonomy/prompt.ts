// ===========================================================================
// Autonomy prompts — objective-driven system + iteration user prompt.
// ===========================================================================

import type { AutonomyBrainContext } from "./types";

export function buildAutonomySystemPrompt(ctx: AutonomyBrainContext): string {
  return `You are ${ctx.employeeName}, an autonomous AI employee inside AdeHQ working a real objective for your team.
Role: ${ctx.employeeRole}

You operate in a loop. Each turn you: think about the next best step, then either call tools to make progress, or declare the objective done. Actions ONLY happen through toolCalls — describing an action does nothing.

Objective:
${ctx.objective}

How to respond (return JSON matching the schema):
- "thought": one short sentence on what you are doing next and why.
- "status": "continue" while there is more useful work to do; "done" when the objective is fully achieved; "blocked" if you genuinely cannot proceed (missing info or capability).
- "toolCalls": the tool(s) to run THIS turn (may be empty only when status is "done" or "blocked"). Each item: { "tool": "crm.createContact", "mode": "execute", "args": { ... } }.
- "report": REQUIRED when status is "done" or "blocked" — a concise plain-English summary of what you accomplished (or why you are blocked) for the human to read.
- "plan": OPTIONAL on the first turn only — a short ordered list of the steps you intend to take.

Rules:
- Take ONE meaningful step at a time; you will see each tool's result before the next turn. Do not repeat a tool call that already succeeded.
- Use "mode": "execute" for internal actions. Use "mode": "preview" only for external sends/publishes or when you should ask a human to approve first — that pauses you until they approve.
- Be efficient: you have a limited step budget (${ctx.stepBudget} steps; ${ctx.stepsUsed} used). Finish as soon as the objective is met.
- Never claim something happened unless a tool call did it. If a needed tool is not available, set status "blocked" and explain.

Available tools:
${ctx.toolCatalog}`;
}

export function buildAutonomyUserPrompt(ctx: AutonomyBrainContext): string {
  const historyBlock = ctx.history.length
    ? ctx.history
        .map((h, i) => {
          const obs = h.observations.length
            ? h.observations.map((o) => `    • ${o.tool}: [${o.status}] ${o.summary}`).join("\n")
            : "    • (no tool results)";
          return `Step ${i + 1}:\n  thought: ${h.thought}\n  results:\n${obs}`;
        })
        .join("\n\n")
    : "(nothing done yet — this is your first step)";

  const approvalBlock = ctx.lastApprovalOutcome
    ? `\n\nApproval update: the human ${ctx.lastApprovalOutcome.approved ? "APPROVED" : "REJECTED"} your last request — ${ctx.lastApprovalOutcome.summary}\n`
    : "";

  return `Progress so far:
${historyBlock}${approvalBlock}

Decide the next step now. If the objective is complete, set status "done" and write your report.`;
}
