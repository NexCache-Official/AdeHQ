"use client";

import { useState } from "react";
import { useStore } from "@/lib/demo-store";
import { PageHeader } from "@/components/Page";
import { PlatformAdminLink } from "@/components/admin/PlatformAdminLink";
import { AccountSecurityCard } from "@/components/settings/AccountSecurityCard";
import { Card, Button } from "@/components/ui";
import { HumanAvatar } from "@/components/EmployeeAvatar";
import { Check, UserCircle } from "lucide-react";

export default function SettingsProfilePage() {
  const { state, actions } = useStore();
  const [name, setName] = useState(state.user?.name ?? "");
  const [email, setEmail] = useState(state.user?.email ?? "");
  const [saved, setSaved] = useState(false);

  const saveProfile = () => {
    actions.updateProfile({ name, email });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <>
      <PageHeader
        title="Profile"
        subtitle="Your personal details across this workspace."
        icon={<UserCircle className="h-5 w-5" />}
        actions={<PlatformAdminLink />}
      />

      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold text-ink">Your profile</h2>
        <div className="flex items-center gap-4">
          <HumanAvatar name={name || "User"} size="xl" />
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-ink-3">Name</span>
              <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-ink-3">Email</span>
              <input className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={saveProfile}>
            <Check className="h-4 w-4" /> {saved ? "Saved!" : "Save changes"}
          </Button>
        </div>
      </Card>

      <div className="mt-6">
        <AccountSecurityCard />
      </div>
    </>
  );
}
