import type { AIEmployee, MemoryEntry, MemoryScope } from "@/lib/types";
import { cleanMemoryTitle, compactMemoryContent } from "./build-entry";
import {
  inferMemoryCategory,
  inferMemoryTags,
  normalizeCategory,
  type MemoryCategory,
} from "./categories";
import { buildMemoryDedupeKey, memoryBodyForFingerprint, type MemoryDedupeInput } from "./fingerprint";
import { normalizeMemoryScope } from "./scope-rules";

export type MemoryCuratorContext = {
  workspaceId: string;
  roomId?: string;
  topicId?: string | null;
  topicTitle?: string;
  isDm?: boolean;
  dmEmployeeId?: string;
  dmEmployeeName?: string;
  suggestedByName?: string;
  savedByName?: string;
  sourceType?: MemoryEntry["sourceType"];
  sourceMessageId?: string;
  sourceEmployeeId?: string;
  existingMemory?: MemoryEntry[];
};

export type CuratedMemoryDraft = {
  title: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
  scope: MemoryScope;
  dedupeKey: string;
  duplicateOfId?: string;
  confidence: number;
};

function stripMentionPrefix(text: string): string {
  return text.replace(/^@[\w\s.'-]+[—–-]\s*/i, "").trim();
}

function firstSentence(text: string, max = 220): string {
  const cleaned = stripMentionPrefix(text).replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  const sentence = (match?.[1] ?? cleaned).trim();
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, max - 1).trim()}…`;
}

function summarizeRawContent(title: string, raw: string): string {
  const body = compactMemoryContent(title, stripMentionPrefix(raw));
  if (!body) return firstSentence(raw, 280);

  if (/provided a brief|gave .+ an overview|explained/i.test(body) && body.length > 120) {
    const who = body.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/)?.[1];
    const topic = body.match(/on\s+(.+?)(?:\.|,|$)/i)?.[1]?.trim();
    if (who && topic) {
      return `${who} shared a briefing on ${topic}. ${firstSentence(body, 160)}`;
    }
  }

  if (body.length <= 320) return body;
  return `${firstSentence(body, 220)} ${firstSentence(body.slice(220), 120)}`.trim();
}

function normalizeTitle(raw: string, category: MemoryCategory, ctx: MemoryCuratorContext): string {
  const title = cleanMemoryTitle(raw, category);

  if (ctx.dmEmployeeName && /provided|gave|shared|explained/i.test(raw)) {
    const short = firstSentence(stripMentionPrefix(raw), 48);
    if (short.length < 60) {
      return `${ctx.dmEmployeeName}'s ${short.replace(/^[^:]+:\s*/, "").slice(0, 40) || "note"}`.slice(0, 72);
    }
  }

  if (category === "Topic Summary" && ctx.topicTitle) {
    return `${ctx.topicTitle} — workstream summary`;
  }

  return title;
}

function recommendScope(ctx: MemoryCuratorContext): MemoryScope {
  if (ctx.dmEmployeeId && ctx.isDm) return "employee_dm";
  if (ctx.topicId) return "topic";
  if (ctx.roomId) return "room";
  return "workspace";
}

function enrichTags(
  tags: string[],
  category: MemoryCategory,
  ctx: MemoryCuratorContext,
  employees: AIEmployee[] = [],
): string[] {
  const out = new Set(tags.map((t) => t.trim()).filter(Boolean));
  if (ctx.dmEmployeeName) out.add(ctx.dmEmployeeName);
  if (ctx.topicTitle) out.add(ctx.topicTitle);
  for (const emp of employees) {
    if (emp.name && `${ctx.dmEmployeeName ?? ""} ${ctx.topicTitle ?? ""}`.includes(emp.name.split(" ")[0] ?? "")) {
      out.add(emp.name);
    }
  }
  if (category !== "Other") {
    const catTag = category.split("/")[0]?.trim();
    if (catTag) out.add(catTag);
  }
  return [...out].slice(0, 8);
}

function inferCategoryEnhanced(text: string, reason: string | undefined, ctx: MemoryCuratorContext): MemoryCategory {
  const hay = `${text} ${reason ?? ""}`;
  if (ctx.dmEmployeeId || ctx.sourceEmployeeId) {
    if (/brief|overview|out-of-role|specialty|personality|instructions/i.test(hay)) {
      return "Employee-Specific Context";
    }
  }
  if (ctx.isDm && /hire|recruit|candidate|job brief/i.test(hay)) return "People / Workforce";
  return inferMemoryCategory(text, reason);
}

function isActiveMemoryEntry(m: MemoryEntry): boolean {
  return m.status !== "archived" && m.status !== "superseded" && !m.deletedAt;
}

export function findObviousDuplicate(
  draft: Pick<CuratedMemoryDraft, "dedupeKey" | "title" | "content">,
  existing: MemoryEntry[] = [],
): MemoryEntry | undefined {
  if (draft.dedupeKey) {
    const byKey = existing.find((m) => m.dedupeKey === draft.dedupeKey);
    if (byKey) return byKey;
  }
  const normTitle = draft.title.toLowerCase().trim();
  const normBody = memoryBodyForFingerprint(draft.content).toLowerCase().trim();
  return existing.find((m) => {
    if (!isActiveMemoryEntry(m)) return false;
    const sameTitle = m.title.toLowerCase().trim() === normTitle;
    const sameBody = memoryBodyForFingerprint(m.content).toLowerCase().trim() === normBody;
    return sameTitle && sameBody;
  });
}

export function curateMemoryDraft(
  rawContent: string,
  ctx: MemoryCuratorContext,
  opts?: { rawTitle?: string; reason?: string; scopeOverride?: MemoryScope; employees?: AIEmployee[] },
): CuratedMemoryDraft {
  const category = normalizeCategory(
    inferCategoryEnhanced(rawContent, opts?.reason, ctx),
  );
  const title = normalizeTitle(opts?.rawTitle ?? rawContent, category, ctx);
  const content = summarizeRawContent(title, rawContent);
  const scope = normalizeMemoryScope(opts?.scopeOverride ?? recommendScope(ctx));
  const baseTags = inferMemoryTags(`${title} ${content}`, category);
  const tags = enrichTags(baseTags, category, ctx, opts?.employees);

  const dedupeInput: MemoryDedupeInput = {
    workspaceId: ctx.workspaceId,
    title,
    content,
    scope,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    sourceMessageId: ctx.sourceMessageId,
  };
  const dedupeKey = buildMemoryDedupeKey(dedupeInput);
  const duplicate = findObviousDuplicate({ dedupeKey, title, content }, ctx.existingMemory);

  return {
    title,
    content,
    category,
    tags,
    scope,
    dedupeKey,
    duplicateOfId: duplicate?.id,
    confidence: duplicate ? 0.95 : 0.82,
  };
}
