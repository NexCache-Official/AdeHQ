"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { canManageWorkspaceSettings } from "@/lib/workspace/permissions";
import { PageHeader } from "@/components/Page";
import { AccountDangerZone } from "@/components/AccountDangerZone";
import { Card, Button, Toggle } from "@/components/ui";
import { Check, RotateCcw, Settings as SettingsIcon } from "lucide-react";

export default function SettingsWorkspacePage() {
  const { state, actions, backend } = useStore();
  const router = useRouter();
  const [workspace, setWorkspace] = useState(state.workspace.name);
  const [saved, setSaved] = useState(false);

  const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role ?? "member";
  const isWorkspaceOwner = myRole === "admin";
  const canManage = canManageWorkspaceSettings(myRole);
  const isRealWorkspace = state.workspace.workspaceMode !== "demo";

  const saveWorkspace = () => {
    actions.updateProfile({ workspaceName: workspace });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <>
      <PageHeader
        title="Workspace"
        subtitle="Workspace name and administrative controls."
        icon={<SettingsIcon className="h-5 w-5" />}
      />

      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-ink">Workspace name</h2>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Name</span>
            <input
              className="input-field"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              disabled={!canManage}
            />
          </label>
          {canManage && (
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={saveWorkspace}>
                <Check className="h-4 w-4" /> {saved ? "Saved!" : "Save changes"}
              </Button>
            </div>
          )}
        </Card>

        {ENABLE_DEMO_MODE && (
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink">Demo mode</h2>
                <p className="mt-0.5 text-sm text-ink-3">
                  Run on deterministic mock responses when demo mode is enabled locally.
                </p>
              </div>
              <Toggle
                checked={state.settings.mode === "mock"}
                onChange={(v) => actions.updateSettings({ mode: v ? "mock" : "live" })}
              />
            </div>
          </Card>
        )}

        {backend === "supabase" && isRealWorkspace && (
          <AccountDangerZone
            workspaceId={state.workspace.id}
            workspaceName={state.workspace.name}
            isWorkspaceOwner={isWorkspaceOwner}
          />
        )}

        {backend === "demo" && ENABLE_DEMO_MODE && (
          <Card className="border-rose-500/20 p-6">
            <h2 className="text-sm font-semibold text-ink">Reset demo data</h2>
            <p className="mt-0.5 text-sm text-ink-3">
              Restore the original demo workspace. This control only appears in demo mode.
            </p>
            <Button
              variant="danger"
              size="sm"
              className="mt-4"
              onClick={() => {
                if (confirm("Reset all demo data? This cannot be undone.")) {
                  actions.resetDemoData();
                  router.push("/");
                }
              }}
            >
              <RotateCcw className="h-4 w-4" /> Reset demo data
            </Button>
          </Card>
        )}
      </div>
    </>
  );
}
