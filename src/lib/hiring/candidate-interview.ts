import { generateText } from "ai";
import { getOutputTokenCap, getTimeoutMs, resolveModel } from "@/lib/ai/model-catalog";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { briefToInstructions } from "./build-brief";
import { INTERVIEW_ANSWERS, INTERVIEW_QUESTIONS } from "./data";
import type { AiEmployeeApplicant, AiEmployeeJobBrief, RecruiterMessage } from "./types";

function formatConversation(messages: RecruiterMessage[]): string {
  return messages
    .map((m) => `${m.role === "user" ? "Interviewer" : "Candidate"}: ${m.text}`)
    .join("\n");
}

function buildInterviewSystemPrompt(
  applicant: AiEmployeeApplicant,
  brief: AiEmployeeJobBrief,
): string {
  return [
    `You are ${applicant.name}, ${applicant.title}, in a pre-hire interview preview for AdeHQ.`,
    "The user is evaluating whether to hire you. Answer in first person — this is a live preview of how you would actually work once hired.",
    "",
    "Job brief:",
    briefToInstructions(brief),
    "",
    "Your candidate profile:",
    `- Intelligence: ${applicant.engineLabel}`,
    `- Strengths: ${applicant.strengths.join("; ")}`,
    `- Watch-outs: ${applicant.watchOuts.join("; ")}`,
    `- Best for: ${applicant.bestFor}`,
    applicant.candidatePitch ? `- Pitch: ${applicant.candidatePitch}` : "",
    applicant.howIWork?.length ? `- How I work: ${applicant.howIWork.join("; ")}` : "",
    applicant.communicationStyle
      ? `- Communication: ${applicant.communicationStyle}`
      : `- Communication: ${brief.communicationStyle}`,
    "",
    "Rules:",
    `- Speak as ${applicant.first} — warm, competent, and specific to this role.`,
    "- Reference the brief and your strengths; avoid generic filler like \"that's a great question\".",
    "- Keep most answers to 3–6 sentences unless drafting sample copy (emails, plans, etc.).",
    "- If asked to draft something, include a realistic sample in your voice.",
    "- Do not mention being an AI model unless directly asked.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function interviewQuestionLabel(questionId: string): string {
  return INTERVIEW_QUESTIONS.find((q) => q.id === questionId)?.label ?? questionId;
}

export function fallbackInterviewAnswer(
  applicant: AiEmployeeApplicant,
  question: string,
): string {
  const normalized = question.trim().toLowerCase();
  const matched = INTERVIEW_QUESTIONS.find(
    (q) =>
      q.label.toLowerCase() === normalized ||
      normalized.includes(q.label.toLowerCase()) ||
      normalized === q.id,
  );
  const answers = INTERVIEW_ANSWERS[applicant.tier] ?? INTERVIEW_ANSWERS.recommended;
  if (matched && answers[matched.id]) {
    return answers[matched.id];
  }
  return `As ${applicant.title}, I'd start from your priorities in the brief, outline a concrete first step, and check in before anything goes external. What outcome matters most to you here?`;
}

export async function generateCandidateInterviewReply(params: {
  applicant: AiEmployeeApplicant;
  brief: AiEmployeeJobBrief;
  conversation: RecruiterMessage[];
  question: string;
}): Promise<{ reply: string; usedFallback: boolean }> {
  const question = params.question.trim();
  if (!question) {
    throw new Error("question is required");
  }

  if (!isSiliconFlowConfigured()) {
    return { reply: fallbackInterviewAnswer(params.applicant, question), usedFallback: true };
  }

  const modelId =
    params.applicant.resolvedModelId || resolveModel("siliconflow", params.applicant.modelMode);
  const maxTokens = Math.min(900, getOutputTokenCap(params.applicant.modelMode));
  const timeoutMs = getTimeoutMs(params.applicant.modelMode);
  const prior = params.conversation.filter(
    (m) => !(m.role === "user" && m.text.trim() === question),
  );

  try {
    const result = await generateText({
      model: siliconFlowChatModel(modelId),
      system: buildInterviewSystemPrompt(params.applicant, params.brief),
      prompt: [
        prior.length ? `Conversation so far:\n${formatConversation(prior)}` : "",
        `Interviewer: ${question}`,
        `Respond as ${params.applicant.first}:`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      temperature: 0.65,
      maxOutputTokens: maxTokens,
      abortSignal: AbortSignal.timeout(timeoutMs),
      providerOptions: siliconFlowProviderOptions(modelId),
    });

    const reply = result.text.trim();
    if (!reply) {
      return { reply: fallbackInterviewAnswer(params.applicant, question), usedFallback: true };
    }
    return { reply, usedFallback: false };
  } catch (error) {
    console.warn("[AdeHQ hiring interview]", error);
    return { reply: fallbackInterviewAnswer(params.applicant, question), usedFallback: true };
  }
}
