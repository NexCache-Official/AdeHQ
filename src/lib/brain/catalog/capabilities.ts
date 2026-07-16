import type { AiCapability } from "@/lib/ai/runtime/types";

/**
 * Brain capability = kind of work. Never a model id.
 * Extends runtime AiCapability with Brain-only modalities.
 */
export type BrainCapability =
  | AiCapability
  | "vision"
  | "image_edit"
  | "video_generation"
  | "search_fast"
  | "search_semantic";

export type BrainCapabilityDef = {
  id: BrainCapability;
  label: string;
  description: string;
  unitType: CapabilityUnitType;
};

export type CapabilityUnitType =
  | "tokens"
  | "image"
  | "video"
  | "utf8_bytes"
  | "search"
  | "browser_second"
  | "audio_seconds";

export const BRAIN_CAPABILITIES: BrainCapabilityDef[] = [
  { id: "quick_reply", label: "Quick reply", description: "Short chat replies", unitType: "tokens" },
  { id: "structured_chat", label: "Structured chat", description: "JSON / schema chat", unitType: "tokens" },
  { id: "reasoning", label: "Reasoning", description: "Everyday employee intelligence", unitType: "tokens" },
  { id: "deep_reasoning", label: "Deep reasoning", description: "Harder multi-step reasoning", unitType: "tokens" },
  { id: "long_context", label: "Long context", description: "Large document / thread context", unitType: "tokens" },
  { id: "coding", label: "Coding", description: "Code generation and review", unitType: "tokens" },
  { id: "classification", label: "Classification", description: "Micro-routing, triage, extraction", unitType: "tokens" },
  { id: "embedding", label: "Embedding", description: "Vector embeddings", unitType: "tokens" },
  { id: "summarization", label: "Summarization", description: "Topic and thread summaries", unitType: "tokens" },
  { id: "memory_curation", label: "Memory", description: "Memory write / curation", unitType: "tokens" },
  { id: "artifact_generation", label: "Artifacts", description: "Reports and documents", unitType: "tokens" },
  { id: "research_planning", label: "Research planning", description: "Plan research steps", unitType: "tokens" },
  { id: "search_fast", label: "Fast search", description: "Current-fact web answers", unitType: "search" },
  { id: "search_semantic", label: "Semantic search", description: "Company / paper / entity discovery", unitType: "search" },
  { id: "browser_research", label: "Browser research", description: "Interactive website work", unitType: "browser_second" },
  { id: "vision", label: "Vision", description: "Screenshots, documents, charts", unitType: "tokens" },
  { id: "image_generation", label: "Image generation", description: "Generate images", unitType: "image" },
  { id: "image_edit", label: "Image edit", description: "Edit existing images", unitType: "image" },
  { id: "video_generation", label: "Video generation", description: "Text/image to video", unitType: "video" },
  { id: "text_to_speech", label: "Text to speech", description: "TTS synthesis", unitType: "utf8_bytes" },
  { id: "speech_to_text", label: "Speech to text", description: "Transcription (STT — model TBD)", unitType: "audio_seconds" },
  { id: "reranking", label: "Reranking", description: "Rerank search hits", unitType: "tokens" },
];

export function getBrainCapability(id: BrainCapability): BrainCapabilityDef | undefined {
  return BRAIN_CAPABILITIES.find((c) => c.id === id);
}
