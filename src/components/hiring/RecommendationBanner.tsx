"use client";

import type { AiEmployeeApplicant } from "@/lib/hiring/types";
import {
  limitBullets,
  recommendationBestIf,
  recommendationHeadline,
} from "@/lib/hiring/candidate-display";

export function RecommendationBanner({
  candidate,
  onHire,
  hireDisabled = false,
}: {
  candidate: AiEmployeeApplicant;
  onHire: () => void;
  hireDisabled?: boolean;
}) {
  const bullets = limitBullets(candidate.strengths, 3);

  return (
    <div className="mt-5 rounded-[14px] bg-gradient-to-b from-ink to-ink/90 p-5 text-white">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-accent-soft">
        Ade&apos;s recommendation
      </div>
      <p className="text-[15px] font-medium leading-snug text-white">
        {recommendationHeadline(candidate)}
      </p>
      {bullets.length > 0 && (
        <ul className="mt-2.5 space-y-1 text-[13px] leading-snug text-white/85">
          {bullets.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-white/50">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2.5 text-[13px] leading-snug text-white/75">
        {recommendationBestIf(candidate)}
      </p>
      <button
        type="button"
        disabled={hireDisabled}
        onClick={onHire}
        className="mt-4 rounded-[10px] bg-white px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
      >
        Hire recommended candidate
      </button>
    </div>
  );
}
