"use client";

import { useMemo, useState } from "react";
import type { AIEmployee, TopicPriority } from "@/lib/types";
import { TOPIC_TEMPLATES } from "@/lib/topics";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { Button, Modal, ModalHeader } from "./ui";
import { Hash, Plus } from "lucide-react";

export function NewTopicModal({
  open,
  onClose,
  roomEmployees,
  onCreate,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  roomEmployees: AIEmployee[];
  onCreate: (payload: {
    title: string;
    description: string;
    priority: TopicPriority;
    aiEmployeeIds: string[];
    starterMessage?: string;
  }) => Promise<void>;
  busy?: boolean;
}) {
  const [templateId, setTemplateId] = useState("custom");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TopicPriority>("normal");
  const [starterMessage, setStarterMessage] = useState("");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);

  const template = TOPIC_TEMPLATES.find((t) => t.id === templateId);

  const suggestedEmployees = useMemo(() => {
    if (!template?.suggestedRoles.length) return [];
    const roles = template.suggestedRoles as readonly string[];
    return roomEmployees.filter((e) => roles.includes(e.roleKey));
  }, [template, roomEmployees]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = TOPIC_TEMPLATES.find((t) => t.id === id);
    if (!tpl || id === "custom") return;
    setTitle(tpl.label);
    setDescription(tpl.description);
    const ids = roomEmployees
      .filter((e) => (tpl.suggestedRoles as readonly string[]).includes(e.roleKey))
      .map((e) => e.id);
    setSelectedEmployees(ids);
  };

  const toggleEmployee = (id: string) => {
    setSelectedEmployees((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const submit = async () => {
    if (!title.trim()) return;
    await onCreate({
      title: title.trim(),
      description: description.trim(),
      priority,
      aiEmployeeIds: selectedEmployees,
      starterMessage: starterMessage.trim() || undefined,
    });
    setTitle("");
    setDescription("");
    setStarterMessage("");
    setSelectedEmployees([]);
    setTemplateId("custom");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader title="New topic" onClose={onClose} icon={<Hash className="h-5 w-5" />} />
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Template</span>
          <select
            className="input-field"
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
          >
            {TOPIC_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Title</span>
          <input
            className="input-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Browser Agent v0"
            autoFocus
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-500">Description / brief</span>
          <textarea
            className="input-field min-h-[72px] resize-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this workstream about?"
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

        {roomEmployees.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Assign AI employees</span>
            {suggestedEmployees.length > 0 && selectedEmployees.length === 0 && (
              <p className="text-[11px] text-slate-500">
                Suggested for this template: {suggestedEmployees.map((e) => e.name).join(", ")}
              </p>
            )}
            <div className="space-y-1">
              {roomEmployees.map((e) => (
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
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!title.trim() || busy}>
          <Plus className="h-4 w-4" /> Create topic
        </Button>
      </div>
    </Modal>
  );
}
