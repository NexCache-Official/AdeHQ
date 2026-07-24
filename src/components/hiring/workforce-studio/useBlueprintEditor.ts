"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acquireLock,
  advanceProvisioning,
  approveBlueprintDraft,
  composeFromArchitect,
  createBlueprint,
  diagnoseBusinessArchitect,
  fetchBlueprint,
  fetchTemplates,
  nextArchitectQuestion,
  patchBlueprintDraft,
  proposeGoalBlueprintOp,
  proposeNlBlueprintEdit,
  releaseLock,
  runSimulation as runSimulationApi,
  startProvisioning,
  type GoalOpImpactSummary,
  type TemplateSummary,
} from "@/lib/hiring/workforce-studio/client-api";
import type { GoalOpId } from "@/lib/hiring/workforce-studio/goal-ops";
import { applyNlEditProposal, type NlEditDiffOp, type NlEditProposal } from "@/lib/hiring/workforce-studio/nl-edit-apply";
import type {
  BusinessOperatingDiagnosis,
  ClarificationAnswer,
  ClarificationQuestion,
} from "@/lib/hiring/workforce-studio/diagnosis-types";
import type {
  SimulationReport,
  TeamHirePlanRecord,
  TeamHirePlanStep,
  WorkforceBlueprintPayload,
  WorkforceBlueprintRecord,
} from "@/lib/hiring/workforce-studio/types";
import { pruneSeatsFromPayload } from "@/lib/hiring/workforce-studio/seat-brief";
import type { AiEmployeeApplicant } from "@/lib/hiring/types";
import { forecastWorkHours } from "@/lib/hiring/workforce-studio/simulation";

export type StudioPhase =
  | "loading"
  | "architect_entry"
  | "architect_diagnosis"
  | "architect_clarify"
  | "team_reveal"
  | "templates"
  | "intake"
  | "editor"
  | "provisioning"
  | "done"
  | "error";

const LOCK_HEARTBEAT_MS = 45_000;
const PROVISION_POLL_MS = 1500;

export function useBlueprintEditor(workspaceId: string | null) {
  const [phase, setPhase] = useState<StudioPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateSummary | null>(null);
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, unknown>>({});
  const [blueprintName, setBlueprintName] = useState("");

  const [blueprint, setBlueprint] = useState<WorkforceBlueprintRecord | null>(null);
  const [draftPayload, setDraftPayload] = useState<WorkforceBlueprintPayload | null>(null);
  const [lockToken, setLockToken] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [simulationReport, setSimulationReport] = useState<SimulationReport | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [approving, setApproving] = useState(false);

  const [plan, setPlan] = useState<TeamHirePlanRecord | null>(null);
  const [steps, setSteps] = useState<TeamHirePlanStep[]>([]);

  const [nlAsking, setNlAsking] = useState(false);
  const [nlProposal, setNlProposal] = useState<{
    proposal: NlEditProposal;
    ops: NlEditDiffOp[];
    impact?: GoalOpImpactSummary | null;
  } | null>(null);
  const [nlMessage, setNlMessage] = useState<string | null>(null);

  // PR-22A Business Architect state
  const [businessDescription, setBusinessDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [diagnosis, setDiagnosis] = useState<BusinessOperatingDiagnosis | null>(null);
  const [clarifyAnswers, setClarifyAnswers] = useState<ClarificationAnswer[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<ClarificationQuestion | null>(null);
  const [clarifyAskedCount, setClarifyAskedCount] = useState(0);
  const [clarifyRemaining, setClarifyRemaining] = useState(0);
  const [architectBusy, setArchitectBusy] = useState(false);
  const [diagnoseStatus, setDiagnoseStatus] = useState<string | null>(null);
  const [designReasons, setDesignReasons] = useState<string[]>([]);
  const [revealWhLow, setRevealWhLow] = useState(0);
  const [revealWhHigh, setRevealWhHigh] = useState(0);
  const [mappingReason, setMappingReason] = useState<string | null>(null);

  // Autosave/save conflict — set when a save is rejected because someone
  // else (or another tab) saved a newer revision first. We NEVER silently
  // overwrite the admin's unsaved local edits: the fresh server copy is held
  // here until the admin explicitly picks "keep mine" or "use latest".
  const [saveConflict, setSaveConflict] = useState<{ server: WorkforceBlueprintRecord } | null>(null);

  const lockTokenRef = useRef<string | null>(null);
  lockTokenRef.current = lockToken;
  const blueprintIdRef = useRef<string | null>(null);

  // Undo/redo — snapshot stack of the draft payload, capped so a long
  // editing session never accumulates unbounded memory.
  const HISTORY_LIMIT = 40;
  const pastRef = useRef<WorkforceBlueprintPayload[]>([]);
  const futureRef = useRef<WorkforceBlueprintPayload[]>([]);
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchTemplates(workspaceId);
        if (cancelled) return;
        setTemplates(list);
        setPhase("architect_entry");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load Workforce Studio.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Lock heartbeat while the editor is open. Ignores responses that arrive
  // after the admin has moved on to a different blueprint (or left the
  // editor via "Start over") so a late refresh can't overwrite the new
  // draft's lockToken and break Approve & Hire.
  useEffect(() => {
    if (phase !== "editor" || !workspaceId || !blueprint) return;
    const heartbeatBlueprintId = blueprint.id;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const refreshed = await acquireLock(workspaceId, heartbeatBlueprintId);
        if (cancelled || blueprintIdRef.current !== heartbeatBlueprintId) return;
        setLockToken(refreshed.lockToken);
      } catch {
        // Best-effort — a failed heartbeat surfaces the next time the user saves.
      }
    }, LOCK_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, workspaceId, blueprint]);

  // Release the lock on unmount.
  useEffect(() => {
    return () => {
      if (workspaceId && blueprintIdRef.current && lockTokenRef.current) {
        void releaseLock(workspaceId, blueprintIdRef.current, lockTokenRef.current);
      }
    };
  }, [workspaceId]);

  const chooseTemplate = useCallback((template: TemplateSummary) => {
    setSelectedTemplate(template);
    setBlueprintName(`${template.name} team`);
    const defaults: Record<string, unknown> = {};
    for (const q of template.intakeQuestions) {
      if (q.defaultValue != null) defaults[q.id] = q.defaultValue;
    }
    setIntakeAnswers(defaults);
    setPhase("intake");
  }, []);

  const openStartingPoints = useCallback(() => {
    setError(null);
    setPhase("templates");
  }, []);

  const startBlankTeam = useCallback(() => {
    const general = templates.find((t) => t.key === "general_ops") ?? templates[0];
    if (!general) {
      setError("No team systems are available yet.");
      return;
    }
    chooseTemplate(general);
  }, [templates, chooseTemplate]);

  const runDiagnose = useCallback(
    async (description: string, siteUrl: string) => {
      if (!workspaceId) return;
      setArchitectBusy(true);
      setDiagnoseStatus(
        siteUrl.trim()
          ? "Reading your description and website…"
          : "Reading your description…",
      );
      setError(null);
      setBusinessDescription(description);
      setWebsiteUrl(siteUrl);
      try {
        const result = await diagnoseBusinessArchitect(workspaceId, {
          description,
          websiteUrl: siteUrl || undefined,
        });
        setDiagnosis(result.diagnosis);
        setClarifyAnswers([]);
        setCurrentQuestion(null);
        setPhase("architect_diagnosis");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Maya couldn't diagnose that business.");
      } finally {
        setArchitectBusy(false);
        setDiagnoseStatus(null);
      }
    },
    [workspaceId],
  );

  const composeArchitectTeam = useCallback(
    async (answers: ClarificationAnswer[]) => {
      if (!workspaceId || !diagnosis) return;
      setArchitectBusy(true);
      setError(null);
      const leftoverId = blueprintIdRef.current;
      const leftoverToken = lockTokenRef.current;
      if (leftoverId && leftoverToken) {
        void releaseLock(workspaceId, leftoverId, leftoverToken);
        blueprintIdRef.current = null;
        lockTokenRef.current = null;
        setLockToken(null);
      }
      try {
        const result = await composeFromArchitect(workspaceId, {
          diagnosis,
          answers,
          businessDescription,
          websiteUrl: websiteUrl || undefined,
        });
        blueprintIdRef.current = result.blueprint.id;
        setBlueprint(result.blueprint);
        setDraftPayload(result.blueprint.draftPayload);
        setLockToken(result.lockToken);
        setBlueprintName(result.blueprint.name);
        setDirty(false);
        setSimulationReport(null);
        setDesignReasons(result.designReasons);
        setRevealWhLow(result.expectedWeeklyWhLow);
        setRevealWhHigh(result.expectedWeeklyWhHigh);
        setMappingReason(result.mappingReason);
        pastRef.current = [];
        futureRef.current = [];
        setHistoryTick((t) => t + 1);
        setPhase("team_reveal");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Maya couldn't compose the team.");
      } finally {
        setArchitectBusy(false);
      }
    },
    [workspaceId, diagnosis, businessDescription, websiteUrl],
  );

  const beginClarify = useCallback(async () => {
    if (!workspaceId || !diagnosis) return;
    setArchitectBusy(true);
    setError(null);
    try {
      const next = await nextArchitectQuestion(workspaceId, {
        diagnosis,
        answers: clarifyAnswers,
      });
      if (next.done) {
        await composeArchitectTeam(clarifyAnswers);
      } else {
        setCurrentQuestion(next.question);
        setClarifyAskedCount(next.askedCount);
        setClarifyRemaining(next.remainingEstimate);
        setPhase("architect_clarify");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the next question.");
    } finally {
      setArchitectBusy(false);
    }
  }, [workspaceId, diagnosis, clarifyAnswers, composeArchitectTeam]);

  const answerClarify = useCallback(
    async (optionId: string, freeText?: string) => {
      if (!workspaceId || !diagnosis || !currentQuestion) return;
      const nextAnswers: ClarificationAnswer[] = [
        ...clarifyAnswers,
        {
          questionId: currentQuestion.id,
          optionId: optionId === "free_text" ? undefined : optionId,
          freeText,
        },
      ];
      setClarifyAnswers(nextAnswers);
      setArchitectBusy(true);
      setError(null);
      try {
        const next = await nextArchitectQuestion(workspaceId, {
          diagnosis,
          answers: nextAnswers,
        });
        if (next.done) {
          await composeArchitectTeam(nextAnswers);
        } else {
          setCurrentQuestion(next.question);
          setClarifyAskedCount(next.askedCount);
          setClarifyRemaining(next.remainingEstimate);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't continue the interview.");
      } finally {
        setArchitectBusy(false);
      }
    },
    [workspaceId, diagnosis, currentQuestion, clarifyAnswers, composeArchitectTeam],
  );

  const backClarify = useCallback(async () => {
    if (!workspaceId || !diagnosis || clarifyAnswers.length === 0) return;
    const previous = clarifyAnswers.slice(0, -1);
    setClarifyAnswers(previous);
    setArchitectBusy(true);
    setError(null);
    try {
      const next = await nextArchitectQuestion(workspaceId, {
        diagnosis,
        answers: previous,
      });
      if (next.done) {
        // Shouldn't happen with fewer answers, but recover gracefully.
        setPhase("architect_diagnosis");
        setCurrentQuestion(null);
        return;
      }
      setCurrentQuestion(next.question);
      setClarifyAskedCount(next.askedCount);
      setClarifyRemaining(next.remainingEstimate);
      setPhase("architect_clarify");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't go back.");
    } finally {
      setArchitectBusy(false);
    }
  }, [workspaceId, diagnosis, clarifyAnswers]);

  const openStudioFromReveal = useCallback(
    (includedSeatIds?: string[]) => {
      if (draftPayload && includedSeatIds && includedSeatIds.length > 0) {
        const keep = new Set(includedSeatIds);
        if (keep.size < draftPayload.seats.length) {
          const pruned = pruneSeatsFromPayload(draftPayload, keep);
          const bands = forecastWorkHours(pruned.seats);
          setDraftPayload(pruned);
          setRevealWhLow(Math.round(bands.reduce((sum, b) => sum + b.lowWh, 0)));
          setRevealWhHigh(Math.round(bands.reduce((sum, b) => sum + b.highWh, 0)));
          setDirty(true);
        }
      }
      setPhase("editor");
    },
    [draftPayload],
  );

  const selectRevealCandidate = useCallback((seatId: string, candidate: AiEmployeeApplicant) => {
    setDraftPayload((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        seats: prev.seats.map((s) =>
          s.id === seatId
            ? {
                ...s,
                preferredCandidateName: candidate.name,
                personalityTraits:
                  candidate.personalityTags?.length > 0
                    ? candidate.personalityTags.slice(0, 4)
                    : s.personalityTraits,
                communicationStyle: candidate.communicationStyle || s.communicationStyle,
              }
            : s,
        ),
      };
    });
    setDirty(true);
  }, []);

  const setAnswer = useCallback((questionId: string, value: unknown) => {
    setIntakeAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  const composeAndEdit = useCallback(async () => {
    if (!workspaceId || !selectedTemplate) return;
    setError(null);
    // Drop any leftover lock from a prior "Start over" session before we
    // create/claim a new draft — belt-and-suspenders with backToTemplates.
    const leftoverId = blueprintIdRef.current;
    const leftoverToken = lockTokenRef.current;
    if (leftoverId && leftoverToken) {
      void releaseLock(workspaceId, leftoverId, leftoverToken);
      blueprintIdRef.current = null;
      lockTokenRef.current = null;
      setLockToken(null);
    }
    try {
      const created = await createBlueprint(workspaceId, {
        templateKey: selectedTemplate.key,
        name: blueprintName,
        intakeAnswers,
      });
      // Point the heartbeat guard at the new id before acquire resolves so a
      // late response from an abandoned draft can't win the setLockToken race.
      blueprintIdRef.current = created.id;
      const lock = await acquireLock(workspaceId, created.id);
      if (blueprintIdRef.current !== created.id) return;
      setBlueprint(created);
      setDraftPayload(created.draftPayload);
      setLockToken(lock.lockToken);
      setDirty(false);
      setSimulationReport(null);
      pastRef.current = [];
      futureRef.current = [];
      setHistoryTick((t) => t + 1);
      setPhase("editor");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compose the team.");
    }
  }, [workspaceId, selectedTemplate, blueprintName, intakeAnswers]);

  const updatePayload = useCallback((updater: (payload: WorkforceBlueprintPayload) => WorkforceBlueprintPayload) => {
    setDraftPayload((prev) => {
      if (!prev) return prev;
      pastRef.current = [...pastRef.current, prev].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      setHistoryTick((t) => t + 1);
      return updater(prev);
    });
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    setDraftPayload((current) => {
      const previous = pastRef.current[pastRef.current.length - 1];
      if (!previous || !current) return current;
      pastRef.current = pastRef.current.slice(0, -1);
      futureRef.current = [...futureRef.current, current];
      setHistoryTick((t) => t + 1);
      setDirty(true);
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setDraftPayload((current) => {
      const next = futureRef.current[futureRef.current.length - 1];
      if (!next || !current) return current;
      futureRef.current = futureRef.current.slice(0, -1);
      pastRef.current = [...pastRef.current, current];
      setHistoryTick((t) => t + 1);
      setDirty(true);
      return next;
    });
  }, []);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  void historyTick; // referenced so the linter knows this drives canUndo/canRedo re-renders

  const askMaya = useCallback(async (instruction: string) => {
    if (!workspaceId || !blueprint) return;
    setNlAsking(true);
    setNlMessage(null);
    setError(null);
    try {
      const result = await proposeNlBlueprintEdit(workspaceId, blueprint.id, instruction);
      if (!result.proposal) {
        setNlMessage(result.message ?? "I couldn't turn that into a concrete change.");
        setNlProposal(null);
      } else {
        setNlProposal({ proposal: result.proposal, ops: result.ops, impact: null });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Maya couldn't process that request.");
    } finally {
      setNlAsking(false);
    }
  }, [workspaceId, blueprint]);

  const runGoalOp = useCallback(
    async (op: GoalOpId) => {
      if (!workspaceId || !blueprint) return;
      setNlAsking(true);
      setNlMessage(null);
      setError(null);
      try {
        const result = await proposeGoalBlueprintOp(workspaceId, blueprint.id, op);
        if (!result.proposal || result.ops.length === 0) {
          setNlMessage(result.message ?? "No structural change needed for that goal.");
          setNlProposal(null);
        } else {
          setNlProposal({ proposal: result.proposal, ops: result.ops, impact: result.impact });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Maya couldn't process that goal.");
      } finally {
        setNlAsking(false);
      }
    },
    [workspaceId, blueprint],
  );

  const applyNlProposal = useCallback(() => {
    if (!nlProposal) return;
    updatePayload((p) => applyNlEditProposal(p, nlProposal.proposal));
    setNlProposal(null);
  }, [nlProposal, updatePayload]);

  const discardNlProposal = useCallback(() => {
    setNlProposal(null);
    setNlMessage(null);
  }, []);

  const dismissAssumption = useCallback((assumptionId: string) => {
    setDiagnosis((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        assumptions: prev.assumptions.filter((a) => a.id !== assumptionId),
        confidence: Math.min(0.95, prev.confidence + 0.03),
      };
    });
  }, []);

  // Dedupes concurrent save() calls within this tab (e.g. autosave firing at
  // the same moment as an explicit "Simulate"/"Approve" pre-save) so they
  // never race each other into a false revision_conflict against ourselves —
  // the second caller just waits for the first request already in flight and
  // reuses its result instead of sending a duplicate PATCH.
  const inFlightSaveRef = useRef<Promise<WorkforceBlueprintRecord | null> | null>(null);

  const save = useCallback(async (changeSummary = "Manual edit"): Promise<WorkforceBlueprintRecord | null> => {
    if (!workspaceId || !blueprint || !draftPayload || !lockToken) return null;
    if (inFlightSaveRef.current) return inFlightSaveRef.current;

    const run = async (): Promise<WorkforceBlueprintRecord | null> => {
      setSaving(true);
      setError(null);
      try {
        const updated = await patchBlueprintDraft(workspaceId, blueprint.id, {
          lockToken,
          expectedRevision: blueprint.revision,
          payload: draftPayload,
          changeSummary,
          name: blueprintName,
        });
        setBlueprint(updated);
        setDraftPayload(updated.draftPayload);
        setDirty(false);
        setSimulationReport(null);
        setSaveConflict(null);
        return updated;
      } catch (err) {
        // Revision conflict — someone (or another tab) saved a newer revision
        // first. Fetch the latest server copy for the recovery prompt, but
        // leave the local draft completely untouched: the admin decides.
        if ((err as { code?: string })?.code === "revision_conflict") {
          try {
            const fresh = await fetchBlueprint(workspaceId, blueprint.id);
            setSaveConflict({ server: fresh });
            setError("This team design changed elsewhere. Choose how to resolve it below before saving again.");
          } catch {
            setError(err instanceof Error ? err.message : "Failed to save changes.");
          }
        } else {
          setError(err instanceof Error ? err.message : "Failed to save changes.");
        }
        return null;
      } finally {
        setSaving(false);
      }
    };

    const promise = run();
    inFlightSaveRef.current = promise;
    try {
      return await promise;
    } finally {
      inFlightSaveRef.current = null;
    }
  }, [workspaceId, blueprint, draftPayload, lockToken, blueprintName]);

  /** Keep my local edits — adopt the server's newer revision/lock bookkeeping
   * so the next Save succeeds, without touching the in-progress draft. */
  const resolveConflictKeepMine = useCallback(async () => {
    if (!workspaceId || !saveConflict) return;
    try {
      const lock = await acquireLock(workspaceId, saveConflict.server.id);
      setBlueprint(saveConflict.server);
      setLockToken(lock.lockToken);
      setSaveConflict(null);
      setError(null);
      // Draft payload deliberately left as-is — it still holds the admin's
      // unsaved edits. Dirty stays true so Save is available immediately.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reacquire the edit lock. Try again.");
    }
  }, [workspaceId, saveConflict]);

  /** Discard my local edits and load the latest server draft instead. */
  const resolveConflictUseLatest = useCallback(async () => {
    if (!workspaceId || !saveConflict) return;
    try {
      const lock = await acquireLock(workspaceId, saveConflict.server.id);
      setBlueprint(saveConflict.server);
      setDraftPayload(saveConflict.server.draftPayload);
      setLockToken(lock.lockToken);
      setDirty(false);
      setSaveConflict(null);
      setError(null);
      pastRef.current = [];
      futureRef.current = [];
      setHistoryTick((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reacquire the edit lock. Try again.");
    }
  }, [workspaceId, saveConflict]);

  // Autosave — debounced background save a few seconds after the admin stops
  // typing/dragging, so work is never lost to a closed tab. Uses the exact
  // same optimistic-concurrency save() path, so a stale revision surfaces
  // through the same saveConflict recovery prompt above rather than ever
  // silently overwriting someone else's newer save.
  const AUTOSAVE_DEBOUNCE_MS = 6_000;
  useEffect(() => {
    if (phase !== "editor" || !dirty || saving || saveConflict) return;
    const timer = setTimeout(() => {
      void save("Autosave");
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [phase, dirty, saving, saveConflict, draftPayload, save]);

  const simulate = useCallback(async () => {
    if (!workspaceId || !blueprint) return;
    setSimulating(true);
    setError(null);
    try {
      // Use the just-saved record's revision, never the stale one captured
      // in this closure — save() may have bumped the revision moments ago.
      let currentRevision = blueprint.revision;
      let currentId = blueprint.id;
      if (dirty) {
        const saved = await save("Pre-simulation save");
        if (!saved) {
          // save() failed or hit a conflict — the error/banner is already
          // surfaced; don't simulate against a payload that didn't persist.
          return;
        }
        currentRevision = saved.revision;
        currentId = saved.id;
      }
      const report = await runSimulationApi(workspaceId, currentId, { expectedRevision: currentRevision });
      setSimulationReport(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed.");
    } finally {
      setSimulating(false);
    }
  }, [workspaceId, blueprint, dirty, save]);

  const approve = useCallback(async () => {
    if (!workspaceId || !blueprint) return;
    setApproving(true);
    setError(null);
    try {
      // Re-acquire (or refresh) immediately before approve so a stale client
      // token — e.g. after Start over → recompose, or a heartbeat race — never
      // blocks hiring with "Someone else is currently editing this blueprint."
      const lock = await acquireLock(workspaceId, blueprint.id);
      if (blueprintIdRef.current !== blueprint.id) return;
      setLockToken(lock.lockToken);

      const approved = await approveBlueprintDraft(workspaceId, blueprint.id, {
        lockToken: lock.lockToken,
        expectedRevision: blueprint.revision,
      });
      setBlueprint(approved);
      setLockToken(null);
      lockTokenRef.current = null;

      const createdPlan = await startProvisioning(workspaceId, approved.id);
      setPlan(createdPlan);
      setPhase("provisioning");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setApproving(false);
    }
  }, [workspaceId, blueprint]);

  // Poll provisioning progress.
  useEffect(() => {
    if (phase !== "provisioning" || !workspaceId || !plan) return;
    if (["completed", "failed", "compensated", "cancelled"].includes(plan.status)) {
      setPhase(plan.status === "completed" ? "done" : "error");
      if (plan.status !== "completed") {
        setError("Provisioning couldn't complete — the team design was rolled back. No partial team was left behind.");
      }
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await advanceProvisioning(workspaceId, plan.id);
        setPlan(result.plan);
        setSteps(result.steps);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Provisioning check failed.");
      }
    }, PROVISION_POLL_MS);
    return () => clearTimeout(timer);
  }, [phase, workspaceId, plan]);

  return {
    phase,
    error,
    setError,
    templates,
    selectedTemplate,
    chooseTemplate,
    intakeAnswers,
    setAnswer,
    blueprintName,
    setBlueprintName,
    composeAndEdit,
    blueprint,
    draftPayload,
    updatePayload,
    dirty,
    saving,
    save,
    saveConflict,
    resolveConflictKeepMine,
    resolveConflictUseLatest,
    simulationReport,
    simulating,
    simulate,
    approving,
    approve,
    plan,
    steps,
    undo,
    redo,
    canUndo,
    canRedo,
    nlAsking,
    nlProposal,
    nlMessage,
    askMaya,
    runGoalOp,
    applyNlProposal,
    discardNlProposal,
    dismissAssumption,
    diagnosis,
    businessDescription,
    websiteUrl,
    currentQuestion,
    clarifyAnswers,
    clarifyAskedCount,
    clarifyRemaining,
    architectBusy,
    diagnoseStatus,
    designReasons,
    revealWhLow,
    revealWhHigh,
    mappingReason,
    runDiagnose,
    beginClarify,
    answerClarify,
    backClarify,
    openStudioFromReveal,
    selectRevealCandidate,
    openStartingPoints,
    startBlankTeam,
    backToTemplates: () => {
      // Release the server-side draft lock before clearing local state.
      // Without this, "Start over" orphans the lock for up to LOCK_TTL and a
      // late heartbeat response can still call setLockToken against the next
      // compose session.
      const previousId = blueprintIdRef.current;
      const previousToken = lockTokenRef.current;
      if (workspaceId && previousId && previousToken) {
        void releaseLock(workspaceId, previousId, previousToken);
      }
      blueprintIdRef.current = null;
      lockTokenRef.current = null;

      setError(null);
      setBlueprint(null);
      setDraftPayload(null);
      setLockToken(null);
      setDirty(false);
      setSimulationReport(null);
      setPlan(null);
      setSteps([]);
      setSelectedTemplate(null);
      setNlProposal(null);
      setNlMessage(null);
      setSaveConflict(null);
      setDiagnosis(null);
      setClarifyAnswers([]);
      setCurrentQuestion(null);
      setDesignReasons([]);
      setMappingReason(null);
      setBusinessDescription("");
      setWebsiteUrl("");
      pastRef.current = [];
      futureRef.current = [];
      setPhase("architect_entry");
    },
  };
}
