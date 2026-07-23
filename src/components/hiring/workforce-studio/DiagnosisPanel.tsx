"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import type { BusinessOperatingDiagnosis } from "@/lib/hiring/workforce-studio/diagnosis-types";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{title}</p>
      <div className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

export function DiagnosisPanel({
  diagnosis,
  busy,
  onContinue,
  onBack,
  onDismissAssumption,
}: {
  diagnosis: BusinessOperatingDiagnosis;
  busy?: boolean;
  onContinue: () => void;
  onBack: () => void;
  onDismissAssumption?: (assumptionId: string) => void;
}) {
  return (
    <div className="studio-fade-up mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Maya</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-ink">
          Here&apos;s how I understand your business
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{diagnosis.narrative}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Business model">
          <p className="font-medium text-ink">{diagnosis.businessType}</p>
          <p className="mt-0.5 capitalize text-ink-3">
            {diagnosis.operatingModel.replace(/_/g, " ")} · {diagnosis.industry}
          </p>
        </Card>
        <Card title="Customers">
          {diagnosis.customerTypes.length
            ? diagnosis.customerTypes.join(" · ")
            : "To be confirmed in the next questions"}
        </Card>
        <Card title="Revenue channels">
          {diagnosis.revenueMotion.length || diagnosis.operatingChannels.length
            ? [...diagnosis.revenueMotion, ...diagnosis.operatingChannels].slice(0, 6).join(" · ")
            : "Still gathering channel detail"}
        </Card>
        <Card title="Recurring work">
          <ul className="list-disc space-y-1 pl-4">
            {diagnosis.recurringWork.slice(0, 4).map((w) => (
              <li key={w.id}>{w.name}</li>
            ))}
          </ul>
        </Card>
        <Card title="Bottlenecks">
          <ul className="list-disc space-y-1 pl-4">
            {diagnosis.bottlenecks.slice(0, 3).map((b) => (
              <li key={b.id}>
                <span className="font-medium text-ink">{b.area}</span> — {b.description}
              </li>
            ))}
            {!diagnosis.bottlenecks.length ? <li>None flagged yet</li> : null}
          </ul>
        </Card>
        <Card title="Assumptions">
          <ul className="space-y-2">
            {diagnosis.assumptions.slice(0, 4).map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-2">
                <span>{a.statement}</span>
                {onDismissAssumption ? (
                  <button
                    type="button"
                    onClick={() => onDismissAssumption(a.id)}
                    className="shrink-0 text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                  >
                    Not true
                  </button>
                ) : null}
              </li>
            ))}
            {!diagnosis.assumptions.length ? <li className="text-ink-3">No major assumptions left</li> : null}
          </ul>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onContinue} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Continue with a few questions
          <ArrowRight className="h-4 w-4" />
        </Button>
        <button type="button" onClick={onBack} className="text-[13px] text-ink-3 hover:text-ink">
          Edit description
        </button>
        <span className="text-[12px] text-ink-3">
          Design confidence: {Math.round(diagnosis.confidence * 100)}%
        </span>
      </div>
    </div>
  );
}
