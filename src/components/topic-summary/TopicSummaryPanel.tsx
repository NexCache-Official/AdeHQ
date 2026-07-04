"use client";

import { useEffect, useMemo, useState } from "react";
import type { AIEmployee, MemoryEntry, MemoryScope, ProjectRoom, RoomMessage, RoomTopic } from "@/lib/types";
import type { TopicSummary } from "@/lib/topic-summary/types";
import {
  dismissMemorySuggestionClient,
  saveFileMemorySuggestionClient,
  saveSuggestedMemoryClient,
  saveTopicSummaryToMemoryClient,
} from "@/lib/topic-summary/client";
import {
  readLocalSuggestionLifecycle,
  resolveSuggestionState,
  setLocalSuggestionState,
  shouldHideSuggestion,
  topicSummarySuggestionKey,
  type MemorySuggestionState,
} from "@/lib/memory/suggestion-lifecycle";
import { MemoryScopeSelect } from "@/components/memory/MemoryScopeSelect";
import { defaultMemoryScope, normalizeMemoryScope } from "@/lib/memory/scope-rules";
import { Button } from "@/components/ui";
import {
  memoryScopeLabel,
  memorySuggestionTitle,
  sanitizeDisplayText,
  sanitizeSummaryText,
  sourceLabelFromMessage,
} from "@/lib/topic-summary/source-labels";
import { jumpToMessage } from "@/lib/navigation/jump-to-source";
import { normalizeCategory } from "@/lib/memory/categories";
import { Check, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

const DISMISSED_ACTIONS_KEY = "adehq:dismissed-next-actions:";

function readIndexSet(keyPrefix: string, topicId: string): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(`${keyPrefix}${topicId}`);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

function writeIndexSet(keyPrefix: string, topicId: string, values: Set<number>) {
  localStorage.setItem(`${keyPrefix}${topicId}`, JSON.stringify(Array.from(values)));
}

function OverviewSection({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  if (empty) return null;
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      <div className="rounded-xl border border-border bg-muted/30 p-3">{children}</div>
    </section>
  );
}

type TopicSummaryPanelProps = {
  topicId: string;
  roomId?: string;
  room?: ProjectRoom;
  topic?: RoomTopic;
  isDm?: boolean;
  summary: TopicSummary | null;
  employees: AIEmployee[];
  messages?: Pick<RoomMessage, "id" | "senderName" | "senderType">[];
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRefresh: () => void;
  onCreateTask?: (title: string, ownerEmployeeId?: string) => void;
  onMemorySaved?: (memory?: MemoryEntry, duplicate?: boolean) => void;
  compactActions?: boolean;
};

export function TopicSummaryPanel({
  topicId,
  roomId,
  room,
  topic,
  isDm = false,
  summary,
  employees,
  messages = [],
  loading,
  refreshing,
  error,
  onRefresh,
  onCreateTask,
  onMemorySaved,
  compactActions = false,
}: TopicSummaryPanelProps) {
  const [savingSummary, setSavingSummary] = useState(false);
  const [savingKeyFacts, setSavingKeyFacts] = useState(false);
  const [savedKeyFacts, setSavedKeyFacts] = useState(false);
  const [savingMemoryIndex, setSavingMemoryIndex] = useState<number | null>(null);
  const [memorySaveError, setMemorySaveError] = useState<string | null>(null);
  const [savedSummary, setSavedSummary] = useState(false);
  const [memoryScopes, setMemoryScopes] = useState<Record<number, MemoryScope>>({});
  const [optimisticStates, setOptimisticStates] = useState<Record<string, MemorySuggestionState>>({});
  const [storageVersion, setStorageVersion] = useState(0);

  useEffect(() => {
    if (summary) return;
    setSavedKeyFacts(false);
    setSavedSummary(false);
    setSavingSummary(false);
    setSavingKeyFacts(false);
    setSavingMemoryIndex(null);
    setMemorySaveError(null);
    setOptimisticStates({});
    setStorageVersion((v) => v + 1);
  }, [summary]);

  const localLifecycle = useMemo(
    () => readLocalSuggestionLifecycle(topicId),
    [topicId, storageVersion],
  );

  const keyForIndex = (index: number): string =>
    topicSummarySuggestionKey(topicId, summary?.suggestedMemory[index] ?? { text: String(index) });

  const suggestionState = (index: number): MemorySuggestionState => {
    const key = keyForIndex(index);
    return resolveSuggestionState(
      key,
      summary?.memorySuggestionLifecycle,
      localLifecycle,
      optimisticStates[key],
    );
  };

  const scopeCtx = useMemo(
    () =>
      room
        ? { room, topic, employees, isDm }
        : null,
    [room, topic, employees, isDm],
  );

  const dismissedActions = useMemo(
    () => readIndexSet(DISMISSED_ACTIONS_KEY, topicId),
    [topicId, storageVersion],
  );

  const visibleMemorySuggestions = (summary?.suggestedMemory ?? []).filter((_, index) => {
    return !shouldHideSuggestion(suggestionState(index));
  });

  const visibleNextActions = (summary?.nextActions ?? []).filter(
    (_, index) => !dismissedActions.has(index),
  );

  const briefSummary = summary?.summary ? sanitizeSummaryText(summary.summary) : "";
  const direction = summary?.currentDecision
    ? sanitizeSummaryText(summary.currentDecision)
    : null;

  const sourceCount = summary?.sourceMessageIds?.length ?? 0;
  const firstSourceMessageId = summary?.sourceMessageIds?.[0];

  const employeeName = (id?: string) =>
    employees.find((e) => e.id === id)?.name ?? "Unassigned";

  const handleSaveMemory = async (index: number) => {
    const key = keyForIndex(index);
    setSavingMemoryIndex(index);
    setMemorySaveError(null);
    setOptimisticStates((prev) => ({ ...prev, [key]: "saving" }));
    try {
      const suggestion = summary?.suggestedMemory[index];
      const result = await saveSuggestedMemoryClient(topicId, index, {
        scope: memoryScopes[index] ?? suggestion?.scope,
      });
      const nextState: MemorySuggestionState = result.duplicate ? "already_saved" : "saved";
      setLocalSuggestionState(topicId, key, nextState);
      setOptimisticStates((prev) => ({ ...prev, [key]: nextState }));
      setStorageVersion((v) => v + 1);
      onMemorySaved?.(result.memory, result.duplicate);
      window.setTimeout(() => setStorageVersion((v) => v + 1), 800);
    } catch (err) {
      setOptimisticStates((prev) => ({ ...prev, [key]: "failed" }));
      setMemorySaveError(err instanceof Error ? err.message : "Could not save memory.");
    } finally {
      setSavingMemoryIndex(null);
    }
  };

  const handleDismissMemory = async (index: number) => {
    const key = keyForIndex(index);
    setLocalSuggestionState(topicId, key, "dismissed");
    setOptimisticStates((prev) => ({ ...prev, [key]: "dismissed" }));
    setStorageVersion((v) => v + 1);
    try {
      await dismissMemorySuggestionClient(topicId, key);
    } catch {
      // local fallback already applied
    }
  };

  const handleSaveKeyFacts = async () => {
    const facts = summary?.keyFacts ?? [];
    if (!facts.length) return;
    setSavingKeyFacts(true);
    setMemorySaveError(null);
    try {
      const text = facts.map((f) => sanitizeDisplayText(f.text)).join("\n");
      const result = await saveFileMemorySuggestionClient(topicId, {
        text,
        reason: "Key facts from topic workstream",
        scope: "topic",
      });
      setSavedKeyFacts(true);
      onMemorySaved?.(result.memory, result.duplicate);
    } catch (err) {
      setMemorySaveError(err instanceof Error ? err.message : "Could not save key facts.");
    } finally {
      setSavingKeyFacts(false);
    }
  };

  const handleSaveSummary = async () => {
    setSavingSummary(true);
    setMemorySaveError(null);
    try {
      const result = await saveTopicSummaryToMemoryClient(topicId);
      setSavedSummary(true);
      onMemorySaved?.(result.memory, result.duplicate);
    } catch (err) {
      setMemorySaveError(err instanceof Error ? err.message : "Could not save summary.");
    } finally {
      setSavingSummary(false);
    }
  };

  const keyFacts = (summary?.keyFacts ?? []).filter((f) => sanitizeDisplayText(f.text));

  const hasContent = Boolean(
    briefSummary ||
      direction ||
      keyFacts.length > 0 ||
      (summary?.openQuestions.length ?? 0) > 0 ||
      visibleNextActions.length > 0 ||
      visibleMemorySuggestions.length > 0,
  );

  return (
    <div className="space-y-4">
      {!compactActions && (
        <div className="flex flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing || loading}>
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Refresh summary
          </Button>
          {briefSummary && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleSaveSummary()}
              disabled={savingSummary || savedSummary}
            >
              {savingSummary ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {savedSummary ? "Saved" : "Save summary to memory"}
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      )}
      {memorySaveError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {memorySaveError}
        </p>
      )}

      {loading && !summary && (
        <p className="text-xs text-ink-3">Loading workstream summary…</p>
      )}

      {!loading && !hasContent && (
        <p className="text-xs text-ink-3">
          No workstream summary yet. Use Summarize after meaningful work in this topic.
        </p>
      )}

      {briefSummary && (
        <OverviewSection title="Brief summary">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{briefSummary}</p>
          {sourceCount > 0 && roomId && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {firstSourceMessageId && (
                <button
                  type="button"
                  onClick={() =>
                    jumpToMessage({ roomId, topicId, messageId: firstSourceMessageId })
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent-soft/30"
                >
                  <ExternalLink className="h-3 w-3" />
                  View source conversation
                </button>
              )}
              <span className="text-[10px] text-ink-3">
                Based on {sourceCount} message{sourceCount === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </OverviewSection>
      )}

      <OverviewSection title="Current direction" empty={!direction}>
        {direction ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{direction}</p>
        ) : (
          <p className="text-[13px] text-ink-3">No decision yet.</p>
        )}
      </OverviewSection>

      {keyFacts.length > 0 && (
        <OverviewSection title="Key facts">
          <ul className="space-y-2">
            {keyFacts.map((fact, index) => {
              const text = sanitizeDisplayText(fact.text);
              const source = sourceLabelFromMessage(fact.sourceMessageId, messages, "short");
              return (
                <li
                  key={`${text}-${index}`}
                  className="rounded-lg border border-border-2 bg-surface px-2.5 py-2"
                >
                  <p className="text-[13px] text-ink">{text}</p>
                  {source && fact.sourceMessageId && roomId && (
                    <button
                      type="button"
                      onClick={() =>
                        jumpToMessage({
                          roomId,
                          topicId,
                          messageId: fact.sourceMessageId!,
                        })
                      }
                      className="mt-1 text-[10px] font-medium text-accent hover:text-accent-d"
                    >
                      {source}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-2.5">
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-[11px]"
              disabled={savingKeyFacts || savedKeyFacts}
              onClick={() => void handleSaveKeyFacts()}
            >
              {savingKeyFacts ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {savedKeyFacts ? "Key facts saved" : `Save ${keyFacts.length} key fact${keyFacts.length === 1 ? "" : "s"} to memory`}
            </Button>
          </div>
        </OverviewSection>
      )}

      {(summary?.openQuestions.length ?? 0) > 0 && (
        <OverviewSection title="Open questions">
          <ul className="space-y-2">
            {summary!.openQuestions.map((question, index) => {
              const source = sourceLabelFromMessage(question.sourceMessageId, messages, "short");
              const text = sanitizeDisplayText(question.text);
              return (
                <li
                  key={`${text}-${index}`}
                  className="flex items-start gap-2 rounded-lg border border-border-2 bg-surface px-2.5 py-2"
                >
                  <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border bg-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-ink">{text}</p>
                    {source && question.sourceMessageId && roomId && (
                      <button
                        type="button"
                        onClick={() =>
                          jumpToMessage({
                            roomId,
                            topicId,
                            messageId: question.sourceMessageId!,
                          })
                        }
                        className="mt-1 text-[10px] font-medium text-accent hover:text-accent-d"
                      >
                        {source}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </OverviewSection>
      )}

      {visibleNextActions.length > 0 && (
        <OverviewSection title="Next actions">
          <ul className="space-y-2">
            {summary!.nextActions.map((action, index) => {
              if (dismissedActions.has(index)) return null;
              const source = sourceLabelFromMessage(action.sourceMessageId, messages, "short");
              return (
                <li
                  key={`${action.title}-${index}`}
                  className="rounded-lg border border-border-2 bg-surface px-2.5 py-2"
                >
                  <p className="text-[13px] font-medium text-ink">{sanitizeDisplayText(action.title)}</p>
                  {action.status && (
                    <p className="mt-0.5 text-[10px] font-medium text-ink-3">{action.status}</p>
                  )}
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    Suggested owner: {employeeName(action.ownerEmployeeId)}
                  </p>
                  {source && action.sourceMessageId && roomId && (
                    <button
                      type="button"
                      onClick={() =>
                        jumpToMessage({
                          roomId,
                          topicId,
                          messageId: action.sourceMessageId!,
                        })
                      }
                      className="mt-1 text-[10px] font-medium text-accent hover:text-accent-d"
                    >
                      {source}
                    </button>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {onCreateTask && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-[10px]"
                        onClick={() => onCreateTask(action.title, action.ownerEmployeeId)}
                      >
                        Create task
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const next = readIndexSet(DISMISSED_ACTIONS_KEY, topicId);
                        next.add(index);
                        writeIndexSet(DISMISSED_ACTIONS_KEY, topicId, next);
                        setStorageVersion((v) => v + 1);
                      }}
                      className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] text-ink-3 hover:bg-muted hover:text-ink"
                    >
                      <X className="h-3 w-3" />
                      Dismiss
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </OverviewSection>
      )}

      {visibleMemorySuggestions.length > 0 && (
        <OverviewSection title="Suggested memory">
          <ul className="space-y-3">
            {summary!.suggestedMemory.map((item, index) => {
              const state = suggestionState(index);
              if (shouldHideSuggestion(state)) return null;
              const isSaving = state === "saving" || savingMemoryIndex === index;
              const isSaved = state === "saved" || state === "already_saved";
              const title = item.title ?? memorySuggestionTitle(item.text);
              const content =
                item.content && item.content.trim() !== title.trim()
                  ? sanitizeDisplayText(item.content)
                  : sanitizeDisplayText(item.text);
              const category = normalizeCategory(item.category ?? "Other");
              const scopeLabel = memoryScopeLabel(
                item.scope,
                topic?.title ?? (isDm ? "Direct Chat" : undefined),
              );
              const source = sourceLabelFromMessage(item.sourceMessageId, messages, "short");
              return (
                <li
                  key={`${item.text}-${index}`}
                  className={cn(
                    "rounded-xl border border-border-2 bg-surface p-3 transition-opacity",
                    isSaved && "opacity-60",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-ink-2">
                      {category}
                    </span>
                    <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-ink-3">
                      {scopeLabel}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] font-semibold leading-snug text-ink">{title}</p>
                  <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-ink-2">{content}</p>
                  {item.tags && item.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.tags.slice(0, 6).map((tag) => (
                        <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-ink-3">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {state === "failed" && (
                    <p className="mt-1 text-[10px] text-red-600">Could not save. Try again.</p>
                  )}
                  {state === "already_saved" && (
                    <p className="mt-1 text-[10px] text-ink-3">Already in memory.</p>
                  )}
                  {scopeCtx && !isSaved && (
                    <div className="mt-3 min-w-0">
                      <p className="mb-1 text-[10px] font-medium text-ink-3">Save to</p>
                      <MemoryScopeSelect
                        compact={false}
                        ctx={{ ...scopeCtx, isDm }}
                        value={
                          memoryScopes[index] ??
                          normalizeMemoryScope(item.scope) ??
                          defaultMemoryScope({ ...scopeCtx, isDm })
                        }
                        onChange={(scope) =>
                          setMemoryScopes((prev) => ({ ...prev, [index]: scope }))
                        }
                      />
                    </div>
                  )}
                  {source && item.sourceMessageId && roomId && (
                    <button
                      type="button"
                      onClick={() =>
                        jumpToMessage({
                          roomId,
                          topicId,
                          messageId: item.sourceMessageId!,
                        })
                      }
                      className="mt-2 text-[10px] font-medium text-accent hover:text-accent-d"
                    >
                      {source}
                    </button>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 text-[11px]"
                      disabled={isSaving || isSaved}
                      onClick={() => void handleSaveMemory(index)}
                    >
                      {isSaving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isSaved ? (
                        <Check className="h-3 w-3" />
                      ) : null}
                      {isSaving
                        ? "Saving…"
                        : state === "already_saved"
                          ? "Already saved"
                          : isSaved
                            ? "Saved"
                            : "Save"}
                    </Button>
                    {!isSaved && (
                      <button
                        type="button"
                        onClick={() => void handleDismissMemory(index)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[11px] text-ink-3 hover:bg-muted hover:text-ink"
                      >
                        <X className="h-3 w-3" />
                        Dismiss
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </OverviewSection>
      )}

      {summary?.lastRefreshedAt && (
        <p className="text-[10px] text-ink-3">
          Summary updated{" "}
          {new Date(summary.lastRefreshedAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}
