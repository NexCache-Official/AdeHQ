"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Save, PlayCircle, CheckCircle2, FileText, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { LoadingState } from "@/components/States";
import { useBlueprintEditor } from "./useBlueprintEditor";
import { TemplatePicker } from "./TemplatePicker";
import { IntakeForm } from "./IntakeForm";
import { RosterEditor } from "./RosterEditor";
import { ProvisioningView } from "./ProvisioningView";
import { ArtifactPreviewModal } from "./ArtifactPreviewModal";
import { NlEditBar } from "./NlEditBar";
import { BusinessEntryPanel } from "./BusinessEntryPanel";
import { DiagnosisPanel } from "./DiagnosisPanel";
import { ClarifyChatPanel } from "./ClarifyChatPanel";
import { TeamReveal } from "./TeamReveal";

export function WorkforceStudioShell({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const editor = useBlueprintEditor(workspaceId);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (editor.phase !== "editor") return;
    function isEditableTarget(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    }
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (editor.dirty && !editor.saving) void editor.save();
        return;
      }
      if (isEditableTarget(e.target)) return;
      if (e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        editor.redo();
      } else if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        editor.undo();
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        editor.redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor, editor.phase, editor.dirty, editor.saving]);

  if (editor.phase === "loading") {
    return <LoadingState full label="Loading Workforce Studio…" />;
  }

  if (editor.phase === "error" && !editor.blueprint) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
        <p className="text-sm text-ink-2">{editor.error ?? "Something went wrong."}</p>
        <Button variant="outline" onClick={() => editor.backToTemplates()}>
          Start over
        </Button>
      </div>
    );
  }

  const inArchitectFlow =
    editor.phase === "architect_entry" ||
    editor.phase === "architect_diagnosis" ||
    editor.phase === "architect_clarify" ||
    editor.phase === "team_reveal" ||
    editor.phase === "templates" ||
    editor.phase === "intake" ||
    editor.phase === "editor";

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-8">
      <div className="mb-5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            if (
              editor.phase === "editor" ||
              editor.phase === "intake" ||
              editor.phase === "templates" ||
              editor.phase === "architect_diagnosis" ||
              editor.phase === "architect_clarify" ||
              editor.phase === "team_reveal"
            ) {
              editor.backToTemplates();
              return;
            }
            router.push("/hire");
          }}
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {inArchitectFlow && editor.phase !== "architect_entry" ? "Start over" : "Back to hiring"}
        </button>

        {editor.phase === "editor" && editor.blueprint ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-ink-3" aria-live="polite">
              rev {editor.blueprint.revision}
              {editor.saving ? " · saving…" : editor.dirty ? " · unsaved (autosaves in a few seconds)" : " · saved"}
            </span>
            <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Undo"
                title="Undo (Ctrl/Cmd+Z)"
                onClick={() => editor.undo()}
                disabled={!editor.canUndo}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Redo"
                title="Redo (Ctrl/Cmd+Shift+Z)"
                onClick={() => editor.redo()}
                disabled={!editor.canRedo}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => editor.save()}
              disabled={editor.saving || !editor.dirty || !!editor.saveConflict}
            >
              {editor.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => editor.simulate()}
              disabled={editor.simulating || !!editor.saveConflict}
            >
              {editor.simulating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              Simulate a week
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
              <FileText className="h-3.5 w-3.5" />
              Preview artifacts
            </Button>
            <Button
              size="sm"
              onClick={() => editor.approve()}
              disabled={
                editor.approving ||
                editor.dirty ||
                editor.simulating ||
                !editor.simulationReport ||
                editor.simulationReport.findings.some((f) => f.severity === "critical")
              }
            >
              {editor.approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Approve &amp; hire
            </Button>
          </div>
        ) : null}
      </div>

      {editor.error ? (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {editor.error}
        </div>
      ) : null}

      {editor.saveConflict ? (
        <div className="mb-4 rounded-lg border border-amber/40 bg-amber/10 px-4 py-3">
          <p className="text-[13px] font-medium text-ink">
            This team design changed since you loaded it (now at revision {editor.saveConflict.server.revision}).
          </p>
          <p className="mt-1 text-[12px] text-ink-2">
            Your unsaved changes are still here — nothing has been overwritten. Choose how to continue:
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => editor.resolveConflictKeepMine()}>
              Keep my changes, save over it
            </Button>
            <Button size="sm" variant="outline" onClick={() => editor.resolveConflictUseLatest()}>
              Discard mine, use the latest version
            </Button>
          </div>
        </div>
      ) : null}

      {editor.phase === "architect_entry" ? (
        <BusinessEntryPanel
          busy={editor.architectBusy}
          onDiagnose={editor.runDiagnose}
          onBrowseStartingPoints={editor.openStartingPoints}
          onStartBlank={editor.startBlankTeam}
        />
      ) : null}

      {editor.phase === "architect_diagnosis" && editor.diagnosis ? (
        <DiagnosisPanel
          diagnosis={editor.diagnosis}
          busy={editor.architectBusy}
          onContinue={() => void editor.beginClarify()}
          onBack={editor.backToTemplates}
          onDismissAssumption={editor.dismissAssumption}
        />
      ) : null}

      {editor.phase === "architect_clarify" && editor.currentQuestion ? (
        <ClarifyChatPanel
          question={editor.currentQuestion}
          askedCount={editor.clarifyAskedCount}
          remainingEstimate={editor.clarifyRemaining}
          busy={editor.architectBusy}
          onAnswer={(optionId, freeText) => void editor.answerClarify(optionId, freeText)}
        />
      ) : null}

      {editor.phase === "team_reveal" && editor.draftPayload ? (
        <TeamReveal
          payload={editor.draftPayload}
          designReasons={editor.designReasons}
          expectedWeeklyWhLow={editor.revealWhLow}
          expectedWeeklyWhHigh={editor.revealWhHigh}
          mappingReason={editor.mappingReason ?? undefined}
          assumptions={editor.diagnosis?.assumptions}
          onOpenStudio={editor.openStudioFromReveal}
        />
      ) : null}

      {editor.phase === "templates" ? (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Starting points</h1>
            <p className="mt-1 text-[13px] text-ink-2">
              Proven team systems you can customise. Prefer a tailored design?{" "}
              <button
                type="button"
                className="text-accent underline-offset-2 hover:underline"
                onClick={editor.backToTemplates}
              >
                Tell Maya about your business
              </button>
              .
            </p>
          </div>
          <TemplatePicker templates={editor.templates} onPick={editor.chooseTemplate} />
        </div>
      ) : null}

      {editor.phase === "intake" && editor.selectedTemplate ? (
        <IntakeForm
          template={editor.selectedTemplate}
          answers={editor.intakeAnswers}
          onAnswer={editor.setAnswer}
          blueprintName={editor.blueprintName}
          onNameChange={editor.setBlueprintName}
          onBack={editor.backToTemplates}
          onSubmit={editor.composeAndEdit}
          submitting={false}
        />
      ) : null}

      {editor.phase === "editor" && editor.draftPayload ? (
        <>
          <div className="mb-5">
            <h1 className="text-2xl font-semibold text-ink">{editor.blueprint?.name}</h1>
            <p className="text-[13px] text-ink-2">
              {editor.draftPayload.seats.length} seats · {editor.draftPayload.rooms.length} rooms ·{" "}
              {editor.draftPayload.edges.length} collaboration edges · Brain selected automatically
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-4 lg:self-start">
              <NlEditBar
                asking={editor.nlAsking}
                proposal={editor.nlProposal}
                message={editor.nlMessage}
                onAsk={editor.askMaya}
                onGoalOp={editor.runGoalOp}
                onApply={editor.applyNlProposal}
                onDiscard={editor.discardNlProposal}
              />
            </div>
            <RosterEditor
              payload={editor.draftPayload}
              updatePayload={editor.updatePayload}
              simulationReport={editor.simulationReport}
            />
          </div>
          <ArtifactPreviewModal
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
            blueprintName={editor.blueprint?.name ?? "Team"}
            payload={editor.draftPayload}
          />
        </>
      ) : null}

      {(editor.phase === "provisioning" || editor.phase === "done" || (editor.phase === "error" && editor.plan)) ? (
        <ProvisioningView
          plan={editor.plan}
          steps={editor.steps}
          error={editor.error}
          onDone={() => (editor.plan?.status === "completed" ? router.push("/workforce") : editor.backToTemplates())}
        />
      ) : null}
    </div>
  );
}
