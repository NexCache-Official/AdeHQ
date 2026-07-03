"use client";

import { useMemo, useState } from "react";
import type { AIEmployee, TopicPriority } from "@/lib/types";
import { TOPIC_TEMPLATES } from "@/lib/topics";
import { isMayaEmployee } from "@/lib/maya-employee";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { Button, Modal, ModalHeader } from "./ui";
import { Hash, Plus } from "lucide-react";

const MAYA_DM_WORKFLOW_TYPES = [
  { id: "hire", label: "Hire: Role", titlePrefix: "Hire: " },
  { id: "improve", label: "Improve: Employee", titlePrefix: "Improve: " },
  { id: "workspace", label: "Workspace help", titlePrefix: "Workspace: " },
  { id: "general", label: "General discussion", titlePrefix: "" },
] as const;

const EMPLOYEE_DM_WORKFLOW_TYPES = [
  { id: "research", label: "Research topic", titlePrefix: "Research: " },
  { id: "followup", label: "Follow-up", titlePrefix: "Follow-up: " },
  { id: "file", label: "File / artifact discussion", titlePrefix: "Files: " },
  { id: "general", label: "General discussion", titlePrefix: "" },
] as const;

export function NewTopicModal({
  open,
  onClose,
  assignableEmployees,
  onCreate,
  busy,
  error,
  isDm = false,
  dmEmployee,
}: {
  open: boolean;
  onClose: () => void;
  assignableEmployees: AIEmployee[];
  onCreate: (payload: {
    title: string;
    description: string;
    priority: TopicPriority;
    aiEmployeeIds: string[];
    starterMessage?: string;
    workflowType?: string;
  }) => Promise<void>;
  busy?: boolean;
  error?: string | null;
  isDm?: boolean;
  dmEmployee?: AIEmployee;
}) {
  const [templateId, setTemplateId] = useState("custom");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TopicPriority>("normal");
  const [starterMessage, setStarterMessage] = useState("");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [workflowType, setWorkflowType] = useState("general");

  const template = TOPIC_TEMPLATES.find((t) => t.id === templateId);
  const isMaya = Boolean(dmEmployee && isMayaEmployee(dmEmployee));
  const workflowTypes = isMaya ? MAYA_DM_WORKFLOW_TYPES : EMPLOYEE_DM_WORKFLOW_TYPES;

  const suggestedEmployees = useMemo(() => {
    if (!template?.suggestedRoles.length) return [];
    const roles = template.suggestedRoles as readonly string[];
    return assignableEmployees.filter((e) => roles.includes(e.roleKey));
  }, [template, assignableEmployees]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = TOPIC_TEMPLATES.find((t) => t.id === id);
    if (!tpl || id === "custom") return;
    setTitle(tpl.label);
    setDescription(tpl.description);
    if (!isDm) {
      const ids = assignableEmployees
        .filter((e) => (tpl.suggestedRoles as readonly string[]).includes(e.roleKey))
        .map((e) => e.id);
      setSelectedEmployees(ids);
    }
  };

  const applyWorkflow = (id: string) => {
    setWorkflowType(id);
    const wf = workflowTypes.find((w) => w.id === id);
    if (!wf || !title.trim()) {
      if (wf?.titlePrefix && !title.trim()) {
        setTitle(wf.titlePrefix.replace(/: $/, ""));
      }
      return;
    }
    if (wf.titlePrefix && !title.startsWith(wf.titlePrefix)) {
      setTitle(`${wf.titlePrefix}${title.replace(/^(Hire|Improve|Research|Follow-up|Files|Workspace):\s*/i, "")}`);
    }
  };

  const toggleEmployee = (id: string) => {
    setSelectedEmployees((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const submit = async () => {
    if (!title.trim() || busy) return;
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        priority,
        aiEmployeeIds: isDm ? [] : selectedEmployees,
        starterMessage: starterMessage.trim() || undefined,
        workflowType: isDm ? workflowType : undefined,
      });
      setTitle("");
      setDescription("");
      setStarterMessage("");
      setSelectedEmployees([]);
      setTemplateId("custom");
      setWorkflowType("general");
      onClose();
    } catch {
      // Parent surfaces the error message; keep the modal open for edits.
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader
        title={isDm ? `New topic with ${dmEmployee?.name ?? "employee"}` : "New topic"}
        onClose={onClose}
        icon={<Hash className="h-5 w-5" />}
      />
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {isDm ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Topic type</span>
            <select
              className="input-field"
              value={workflowType}
              onChange={(e) => applyWorkflow(e.target.value)}
            >
              {workflowTypes.map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-ink-3">
              Direct Chat stays your main thread — this creates a focused side topic with {dmEmployee?.name}.
            </p>
          </label>
        ) : (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Template</span>
            <select className="input-field" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              {TOPIC_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>
        )}

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Title</span>
          <input
            className="input-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isDm ? "e.g. Q3 pipeline research" : "Browser Agent v0"}
            autoFocus
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Purpose (optional)</span>
          <textarea
            className="input-field min-h-[72px] resize-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={isDm ? "What is this side thread for?" : "What is this workstream about?"}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Priority</span>
          <select
            className="input-field"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TopicPriority)}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>

        {!isDm && assignableEmployees.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Assign AI employees</span>
            {suggestedEmployees.length > 0 && selectedEmployees.length === 0 && (
              <p className="text-[11px] text-slate-500">
                Suggested for this template: {suggestedEmployees.map((e) => e.name).join(", ")}
              </p>
            )}
            <div className="space-y-1">
              {assignableEmployees.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggleEmployee(e.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-colors ${
                    selectedEmployees.includes(e.id)
                      ? "border-accent-500/40 bg-accent-500/10"
                      : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                  }`}
                >
                  <EmployeeAvatar employee={e} size="xs" showStatus={false} />
                  <span className="text-sm text-slate-800">{e.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Starter message (optional)</span>
          <textarea
            className="input-field min-h-[56px] resize-none"
            value={starterMessage}
            onChange={(e) => setStarterMessage(e.target.value)}
            placeholder="Kick off the topic with context…"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={!title.trim() || busy}>
          <Plus className="h-4 w-4" /> {busy ? "Creating…" : "Create topic"}
        </Button>
      </div>
    </Modal>
  );
}
