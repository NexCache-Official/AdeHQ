"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { AiEmployeeJobBrief } from "@/lib/hiring/types";
import type { BriefComposeSection } from "@/lib/hiring/detect-brief-change";
import {
  MAYA_BRIEF_ATTRIBUTION,
  MAYA_EMPLOYEE_NAME,
} from "@/lib/hiring/maya";
import type { BriefUpdateState } from "@/lib/hiring/maya-recruiter-state";
import { briefSectionToComposeKey, primaryUpdatingLabel } from "@/lib/hiring/maya-recruiter-state";
import {
  BriefSectionBlock,
  BulletList,
  LiveBriefCursor,
  MetaLine,
  TypewriterText,
} from "./BriefSections";

export function BriefDocumentPreview({
  brief,
  live = true,
  composing = false,
  composingSection = null,
  updateState,
}: {
  brief?: Partial<AiEmployeeJobBrief>;
  live?: boolean;
  composing?: boolean;
  composingSection?: BriefComposeSection | null;
  updateState?: BriefUpdateState;
}) {
  const b = brief ?? {};
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<BriefComposeSection, HTMLDivElement | null>>>({});
  const hasTitle = Boolean(b.roleTitle?.trim());
  const sectionActive = (key: BriefComposeSection) => composing && composingSection === key;
  const isUpdating = updateState?.status === "updating";
  const isUpdated = updateState?.status === "updated";
  const isThinking = (composing && !composingSection) || isUpdating;

  const sectionTag = (composeKey: BriefComposeSection) => {
    if (!updateState || updateState.status === "idle") return null;
    const updatingKeys = updateState.sectionsUpdating
      .map(briefSectionToComposeKey)
      .filter(Boolean) as BriefComposeSection[];
    if (updateState.status === "updating" && updatingKeys.includes(composeKey)) {
      return "updating" as const;
    }
    if (updateState.status === "updated" && sectionActive(composeKey)) {
      return "updated" as const;
    }
    return null;
  };

  const statusLabel = isUpdating
    ? `Updating ${primaryUpdatingLabel(updateState?.sectionsUpdating ?? [])}…`
    : isUpdated
      ? "Brief updated"
      : isThinking
        ? "updating…"
        : composing
          ? "editing live"
          : "live";

  useEffect(() => {
    if (!composingSection) return;
    const node = sectionRefs.current[composingSection];
    if (!node || !scrollRef.current) return;
    const frame = requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [composingSection, b.roleTitle, b.mission, b.coreResponsibilities?.length]);

  const setSectionRef = (key: BriefComposeSection) => (node: HTMLDivElement | null) => {
    sectionRefs.current[key] = node;
  };

  return (
    <motion.div
      layout
      className="sticky top-[90px] overflow-hidden rounded-[18px] border border-border bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_8px_32px_-20px_rgba(34,31,26,0.18)]"
    >
      <div className="flex items-center justify-between border-b border-border bg-gradient-to-b from-muted/50 to-surface px-5 py-3.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
          Draft Job Brief
        </span>
        {live && (
          <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <span className={cnPulseDot(isThinking || composing)} />
            {statusLabel}
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="max-h-[min(720px,calc(100vh-11rem))] overflow-y-auto px-5 py-5"
      >
        <div ref={setSectionRef("title")}>
        {hasTitle ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cnTitleBlock(sectionActive("title"))}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-ink">
                {sectionActive("title") ? (
                  <TypewriterText text={b.roleTitle!} active />
                ) : (
                  b.roleTitle
                )}
              </h2>
              {sectionTag("title") && (
                <span className="font-mono text-[10px] normal-case text-accent">{sectionTag("title")}…</span>
              )}
            </div>
            {b.domain && (
              <p className="mt-1 text-[13px] text-ink-2">
                {sectionActive("title") ? (
                  <TypewriterText text={b.domain} active speed={10} />
                ) : (
                  b.domain
                )}
              </p>
            )}
          </motion.div>
        ) : (
          <div className="space-y-2">
            <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted/70" />
          </div>
        )}
        </div>

        <div ref={setSectionRef("mission")}>
        <BriefSectionBlock
          label="Mission"
          empty={!b.mission}
          active={sectionActive("mission")}
          updateTag={sectionTag("mission")}
        >
          <p className="font-serif text-[17px] italic leading-relaxed text-ink">
            {sectionActive("mission") ? (
              <TypewriterText text={b.mission!} active speed={12} />
            ) : (
              b.mission
            )}
          </p>
        </BriefSectionBlock>
        </div>

        <div ref={setSectionRef("coreResponsibilities")}>
        <BriefSectionBlock
          label="Responsibilities"
          empty={!b.coreResponsibilities?.length}
          active={sectionActive("coreResponsibilities")}
          updateTag={sectionTag("coreResponsibilities")}
        >
          <BulletList
            items={b.coreResponsibilities}
            placeholder="Gathering responsibilities…"
            composing={sectionActive("coreResponsibilities")}
            composeAll={sectionActive("coreResponsibilities")}
          />
        </BriefSectionBlock>
        </div>

        {((b.technicalFocus?.length ?? 0) > 0 || sectionTag("technicalFocus") === "updating") && (
          <div ref={setSectionRef("technicalFocus")}>
          <BriefSectionBlock
            label="Technical Focus"
            active={sectionActive("technicalFocus")}
            updateTag={sectionTag("technicalFocus")}
            empty={!b.technicalFocus?.length}
          >
            <BulletList
              items={b.technicalFocus}
              composing={sectionActive("technicalFocus")}
              composeAll={sectionActive("technicalFocus")}
              placeholder="Refining technical focus…"
            />
          </BriefSectionBlock>
          </div>
        )}

        {((b.businessFocus?.length ?? 0) > 0 || sectionTag("businessFocus") === "updating") && (
          <div ref={setSectionRef("businessFocus")}>
          <BriefSectionBlock
            label="Business Focus"
            active={sectionActive("businessFocus")}
            updateTag={sectionTag("businessFocus")}
            empty={!b.businessFocus?.length}
          >
            <BulletList
              items={b.businessFocus}
              composing={sectionActive("businessFocus")}
              composeAll={sectionActive("businessFocus")}
              placeholder="Refining business focus…"
            />
          </BriefSectionBlock>
          </div>
        )}

        {(b.approvalRules?.length ?? 0) > 0 && (
          <div ref={setSectionRef("meta")}>
          <BriefSectionBlock label="Approval Rules" updateTag={sectionTag("meta")}>
            <BulletList
              items={b.approvalRules}
              composing={sectionActive("meta")}
              composeAll={sectionActive("meta")}
            />
          </BriefSectionBlock>
          </div>
        )}

        <div ref={setSectionRef("successMetrics")}>
        <BriefSectionBlock
          label="Success Metrics"
          empty={!b.successMetrics?.length}
          active={sectionActive("successMetrics")}
          updateTag={sectionTag("successMetrics")}
        >
          <BulletList
            items={b.successMetrics}
            placeholder="Defining success metrics…"
            composing={sectionActive("successMetrics")}
            composeAll={sectionActive("successMetrics")}
          />
        </BriefSectionBlock>
        </div>

        {(b.assumptions?.length ?? 0) > 0 && (
          <div ref={setSectionRef("assumptions")}>
          <BriefSectionBlock
            label="Assumptions"
            active={sectionActive("assumptions")}
          >
            <BulletList
              items={b.assumptions}
              composing={sectionActive("assumptions")}
              composeAll={sectionActive("assumptions")}
            />
          </BriefSectionBlock>
          </div>
        )}

        {(b.openQuestions?.length ?? 0) > 0 && (
          <div ref={setSectionRef("openQuestions")}>
          <BriefSectionBlock
            label="Open Questions"
            active={sectionActive("openQuestions")}
          >
            <BulletList
              items={b.openQuestions}
              composing={sectionActive("openQuestions")}
              composeAll={sectionActive("openQuestions")}
            />
          </BriefSectionBlock>
          </div>
        )}

        <div ref={setSectionRef("meta")} className={cnMetaBlock(sectionActive("meta"))}>
          <MetaLine label="Seniority" value={b.seniorityLevel} composing={sectionActive("meta")} />
          <MetaLine label="Autonomy" value={b.autonomyLevel} composing={sectionActive("meta")} />
          <MetaLine label="Style" value={b.communicationStyle} composing={sectionActive("meta")} />
          <MetaLine label="Proactivity" value={b.proactivityLevel} composing={sectionActive("meta")} />
          <MetaLine label="Priority" value={b.qualityPreference} composing={sectionActive("meta")} />
          {sectionActive("meta") && <LiveBriefCursor />}
        </div>

        {isThinking && (
          <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-3">
            <LiveBriefCursor />
            <span>
              {isUpdating
                ? `${MAYA_EMPLOYEE_NAME} is updating ${primaryUpdatingLabel(updateState?.sectionsUpdating ?? [])}…`
                : `${MAYA_EMPLOYEE_NAME} is updating the brief…`}
            </span>
          </div>
        )}

        <p className="mt-5 border-t border-border/70 pt-4 text-[13px] text-ink-3">
          {MAYA_BRIEF_ATTRIBUTION}
        </p>
      </div>
    </motion.div>
  );
}

function cnPulseDot(active: boolean) {
  return `h-1.5 w-1.5 rounded-full ${active ? "animate-pulse bg-accent" : "animate-pulse bg-green"}`;
}

function cnTitleBlock(active: boolean) {
  return active
    ? "-mx-2 rounded-xl bg-accent-soft/35 px-2 py-2 ring-1 ring-accent/25 transition-colors duration-300"
    : "";
}

function cnMetaBlock(active: boolean) {
  return `flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 pt-4 ${
    active ? "-mx-2 rounded-xl bg-accent-soft/35 px-2 ring-1 ring-accent/25" : ""
  }`;
}
