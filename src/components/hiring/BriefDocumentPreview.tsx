"use client";

import { motion } from "framer-motion";
import type { AiEmployeeJobBrief } from "@/lib/hiring/types";
import { BriefSectionBlock, BulletList, MetaLine } from "./BriefSections";

export function BriefDocumentPreview({
  brief,
  live = true,
}: {
  brief?: Partial<AiEmployeeJobBrief>;
  live?: boolean;
}) {
  const b = brief ?? {};
  const hasTitle = Boolean(b.roleTitle?.trim());

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
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green" />
            live
          </span>
        )}
      </div>

      <div className="max-h-[min(520px,70vh)] overflow-y-auto px-5 py-5">
        {hasTitle ? (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <h2 className="text-xl font-semibold tracking-tight text-ink">{b.roleTitle}</h2>
            {b.domain && (
              <p className="mt-1 text-[13px] text-ink-2">{b.domain}</p>
            )}
          </motion.div>
        ) : (
          <div className="space-y-2">
            <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted/70" />
          </div>
        )}

        <BriefSectionBlock label="Mission" empty={!b.mission}>
          <p className="font-serif text-[17px] italic leading-relaxed text-ink">{b.mission}</p>
        </BriefSectionBlock>

        <BriefSectionBlock
          label="Responsibilities"
          empty={!b.coreResponsibilities?.length}
        >
          <BulletList items={b.coreResponsibilities} placeholder="Gathering responsibilities…" />
        </BriefSectionBlock>

        {(b.technicalFocus?.length ?? 0) > 0 && (
          <BriefSectionBlock label="Technical Focus">
            <BulletList items={b.technicalFocus} />
          </BriefSectionBlock>
        )}

        <BriefSectionBlock label="Success Metrics" empty={!b.successMetrics?.length}>
          <BulletList items={b.successMetrics} placeholder="Defining success metrics…" />
        </BriefSectionBlock>

        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 pt-4">
          <MetaLine label="Seniority" value={b.seniorityLevel} />
          <MetaLine label="Autonomy" value={b.autonomyLevel} />
          <MetaLine label="Style" value={b.communicationStyle} />
          <MetaLine label="Proactivity" value={b.proactivityLevel} />
          <MetaLine label="Priority" value={b.qualityPreference} />
        </div>
      </div>
    </motion.div>
  );
}
