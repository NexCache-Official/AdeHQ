import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/ai/model-catalog";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { getRoleByKey } from "@/lib/hiring/role-library";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import type { RecruiterMessage, RecruiterSuggestionChip } from "./types";

const chipPlannerSchema = z.object({
  chips: z
    .array(
      z.object({
        label: z.string().min(2).max(56),
        value: z.string().min(2).max(140),
        intent: z
          .enum([
            "answer_question",
            "review_brief",
            "draft_brief_now",
            "refine_more",
            "add_tools",
            "add_approval_rules",
          ])
          .optional()
          .default("answer_question"),
      }),
    )
    .min(2)
    .max(5),
});

function toSuggestionChips(
  items: Array<{ label: string; value: string; intent?: RecruiterSuggestionChip["intent"] }>,
): RecruiterSuggestionChip[] {
  return items.map((item, index) => ({
    id: `chip-${index}-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    label: item.label.trim(),
    value: item.value.trim(),
    intent: item.intent ?? "answer_question",
  }));
}

function formatConversation(conversation: RecruiterMessage[]): string {
  return conversation
    .slice(-8)
    .map((message) => `${message.role === "ade" ? "Maya" : "User"}: ${message.text}`)
    .join("\n");
}

/** Dynamic chip planner — analyzes Maya's question and hiring context, any role. */
export async function planRecruiterSuggestionChips(input: {
  lastAdeMessage: string;
  roleTitle: string;
  department: string;
  domain?: string;
  mission?: string;
  businessFocus?: string[];
  technicalFocus?: string[];
  lastUserMessage?: string;
  recentConversation?: RecruiterMessage[];
  roleKey?: string | null;
  mode?: "gathering" | "ready_to_review";
}): Promise<RecruiterSuggestionChip[] | null> {
  const lastAde = input.lastAdeMessage.trim();
  if (!lastAde || lastAde.length < 8) return null;
  if (!isSiliconFlowConfigured()) return null;

  const role = getRoleByKey(input.roleKey ?? undefined);
  const mode = input.mode ?? "gathering";
  const focusBlob = [...(input.businessFocus ?? []), ...(input.technicalFocus ?? [])]
    .filter(Boolean)
    .join(", ");

  try {
    const modelId = resolveModel("siliconflow", "cheap");
    const { object } = await generateObject({
      model: siliconFlowChatModel(modelId),
      schema: chipPlannerSchema,
      system:
        mode === "ready_to_review"
          ? `You suggest tap-to-answer chips for Maya (AI workforce manager) when the job brief is nearly ready.

Rules:
1. Propose 3–4 natural next steps based on the role and conversation (e.g. review brief, generate candidates, refine responsibilities).
2. Include "Review job brief" with intent review_brief when appropriate.
3. Labels short (1–5 words). Values can be natural reply text the user would send.
4. Match the hired role domain — never default to engineering stacks for non-technical roles.`
          : `You suggest tap-to-answer chips for Maya (AI workforce manager) during hiring discovery for ANY role.

Rules:
1. Chips must DIRECTLY answer Maya's latest question — extract options she listed, or natural one-tap replies.
2. Analyze the question semantically. Social channels → channel chips. Legal scope → legal chips. Engineering stack → stack chips. Never cross domains.
3. Labels short (1–5 words). Values can be slightly longer natural replies.
4. Do NOT invent generic templates unrelated to the question.
5. Return 3–4 chips. Add "Not sure — help me decide" only when the question is genuinely open-ended.`,
      prompt: [
        `Hiring mode: ${mode}`,
        `Role: ${input.roleTitle || "AI employee"}`,
        `Department: ${input.department || "General"}`,
        input.domain ? `Domain: ${input.domain}` : "",
        focusBlob ? `Focus so far: ${focusBlob}` : "",
        input.mission ? `Mission draft: ${input.mission}` : "",
        role?.questionTemplates.coreWork
          ? `Role discovery question template (context only): ${role.questionTemplates.coreWork}`
          : "",
        input.lastUserMessage?.trim()
          ? `User's last reply: ${input.lastUserMessage.trim()}`
          : "User has not replied to the latest question yet.",
        input.recentConversation?.length
          ? `\nRecent conversation:\n${formatConversation(input.recentConversation)}`
          : "",
        "",
        `Maya's latest message — chips MUST answer this:`,
        lastAde,
      ]
        .filter(Boolean)
        .join("\n"),
      maxOutputTokens: 360,
      providerOptions: siliconFlowProviderOptions(modelId),
    });

    const chips = toSuggestionChips(object.chips);
    return chips.length >= 2 ? chips : null;
  } catch {
    return null;
  }
}
