import { isGeneralTopic } from "@/lib/topics";
import type { RoomTopic } from "@/lib/types";
import type { OrchestrationIntent, OrchestratorInput, TopicStewardSuggestion } from "./types";

const WORKSTREAM_KEYWORDS = [
  /\bpricing\b/i,
  /\bpro plus\b/i,
  /\blaunch\b/i,
  /\bcampaign\b/i,
  /\bclient\b/i,
  /\bfeature\b/i,
  /\bbug\b/i,
  /\bmarket\b/i,
  /\bcompetitor\b/i,
  /\broadmap\b/i,
  /\bdecision\b/i,
  /\bstrategy\b/i,
  /\bonboarding\b/i,
];

const SKIP_INTENTS: OrchestrationIntent[] = ["silent_note", "social_broadcast"];

function titleCase(seed: string): string {
  return seed
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function inferTopicTitle(messages: OrchestratorInput["recentMessages"]): string | null {
  const blob = messages
    .slice(-6)
    .map((m) => m.text)
    .join(" ");
  if (/\bpricing\b/i.test(blob)) return "Pricing Strategy";
  if (/\bpro plus\b/i.test(blob)) return "Pro Plus Pricing";
  if (/\blawnmower\b/i.test(blob)) return "Lawnmower Market Research";
  if (/\bcompetitor\b/i.test(blob)) return "Competitive Positioning";
  if (/\blaunch\b/i.test(blob)) return "Launch Planning";
  if (/\boutreach\b/i.test(blob)) return "Outreach Planning";
  const match = blob.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/);
  return match ? titleCase(match[1]) : null;
}

function topicSimilarity(title: string, messageText: string): number {
  const words = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const lower = messageText.toLowerCase();
  if (!words.length) return 0;
  const hits = words.filter((w) => lower.includes(w)).length;
  return hits / words.length;
}

export function suggestTopics(
  input: OrchestratorInput,
  intent: OrchestrationIntent,
  topic?: Pick<RoomTopic, "title" | "metadata">,
): TopicStewardSuggestion[] {
  if (input.isDm || input.isMayaHiringSession) return [];
  if (SKIP_INTENTS.includes(intent)) return [];

  const text = input.messageText.trim();
  if (!text || text.length < 12) return [];

  const recentInTopic = input.recentMessages.filter(
    (m) => !input.topicId || m.topicId === input.topicId,
  );
  const relatedCount = recentInTopic.filter((m) => m.senderType === "human").length;
  const hasWorkstreamSignal = WORKSTREAM_KEYWORDS.some((p) => p.test(text));
  const onGeneral = topic ? isGeneralTopic(topic as RoomTopic) : true;

  for (const existing of input.existingTopics) {
    if (existing.title.toLowerCase() === "general") continue;
    const similarity = Math.max(
      topicSimilarity(existing.title, text),
      existing.summary ? topicSimilarity(existing.title, existing.summary) : 0,
    );
    if (similarity >= 0.55) {
      return [
        {
          type: "move_to_existing_topic",
          topicId: existing.id,
          topicTitle: existing.title,
          reason: `This seems related to "${existing.title}".`,
          confidence: Math.min(0.92, 0.7 + similarity * 0.2),
          messageIds: [input.messageId],
        },
      ];
    }
  }

  const inferredTitle = inferTopicTitle([...recentInTopic, { id: input.messageId, senderType: "human", text, createdAt: new Date().toISOString() }]);
  if (!inferredTitle) return [];

  const confidence =
    0.55 +
    (hasWorkstreamSignal ? 0.2 : 0) +
    (relatedCount >= 3 ? 0.15 : relatedCount >= 2 ? 0.08 : 0) +
    (onGeneral ? 0.08 : 0);

  if (confidence < 0.78) return [];

  const messageIds = recentInTopic.slice(-4).map((m) => m.id);
  if (!messageIds.includes(input.messageId)) messageIds.push(input.messageId);

  return [
    {
      type: "create_topic",
      title: inferredTitle,
      reason: onGeneral
        ? "This conversation has become a focused workstream. A dedicated topic keeps context scoped."
        : "A scoped topic would help organize this workstream.",
      confidence: Math.min(0.95, confidence),
      messageIds,
    },
  ];
}
