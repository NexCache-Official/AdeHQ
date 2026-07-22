import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/ai/model-catalog";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured } from "@/lib/config/features";

const personalizedQuestionSchema = z.object({
  message: z.string().min(8).max(280),
  chips: z.array(z.string().min(1).max(48)).min(2).max(4),
});

export type PersonalizeQuestionInput = {
  roleTitle: string;
  departmentLabel: string;
  businessFocus?: string[];
  /** Which readiness slot this question is filling — used only as grounding context. */
  slot: string;
  /** The deterministic, already role-category-aware turn (ack + question) — the safety net. */
  fallbackMessage: string;
  fallbackChips: string[];
};

export type PersonalizedQuestion = { message: string; chips: string[] };

const TIMEOUT_MS = 4000;

/**
 * Reflavor ONE recruiter turn (a handful of generic slots — quality
 * preference, seniority, communication style, tools, approvals) with a tiny,
 * cheap-model call so it reads like a real hiring partner asking about THIS
 * role, not a template. Always falls back to the deterministic message on
 * any failure, timeout, or missing config — never blocks or breaks the chat,
 * and never runs for the slots that already have role-specific templates.
 */
export async function personalizeRecruiterQuestion(
  input: PersonalizeQuestionInput,
): Promise<PersonalizedQuestion | null> {
  if (!isSiliconFlowConfigured()) return null;
  if (!input.roleTitle.trim()) return null;

  try {
    const modelId = resolveModel("siliconflow", "cheap");
    const objectPromise = generateObject({
      model: siliconFlowChatModel(modelId),
      schema: personalizedQuestionSchema,
      system: `You are Maya, AdeHQ's AI Workforce Manager. AdeHQ lets teams hire AI employees that do real work for the team — research, tickets, outreach, code, and more — not chatbots that just talk.

You are mid-way through a quick hiring intake chat for ONE specific role. Rewrite the next turn so it reads like a sharp, warm human recruiter who clearly understands this exact role — never generic dev/shipping language unless the role is genuinely engineering.

Rules:
1. Keep it ONE short turn: a brief acknowledgment, then exactly ONE question ending in "?".
2. The question must ask about the same topic as the fallback (do not change what is being asked), just phrase it in language that fits this role and industry.
3. Never invent facts about the role that were not given.
4. Return 2-4 short answer chips (1-4 words each) that directly answer your question — plain labels, no leading "or"/"they".
5. Keep it concise — no corporate filler, no "I have enough" boilerplate.`,
      prompt: [
        `Role: ${input.roleTitle}`,
        `Department: ${input.departmentLabel}`,
        input.businessFocus?.length ? `Focus so far: ${input.businessFocus.join(", ")}` : "",
        `Topic: ${input.slot.replace(/_/g, " ")}`,
        `Fallback turn (reference for meaning only — improve the wording for this exact role, don't just copy it): "${input.fallbackMessage}"`,
        `Fallback answer options: ${input.fallbackChips.join(", ")}`,
      ]
        .filter(Boolean)
        .join("\n"),
      maxOutputTokens: 200,
      providerOptions: siliconFlowProviderOptions(modelId),
    });

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), TIMEOUT_MS);
    });

    const result = await Promise.race([objectPromise, timeoutPromise]);
    if (!result) return null;

    const message = result.object.message.trim();
    if (!message || !/\?\s*$/.test(message)) return null;
    const chips = result.object.chips.map((chip) => chip.trim()).filter(Boolean);
    if (chips.length < 2) return null;

    return { message, chips: chips.slice(0, 4) };
  } catch (error) {
    console.warn("[AdeHQ hiring recruiter] question personalization skipped", error);
    return null;
  }
}
