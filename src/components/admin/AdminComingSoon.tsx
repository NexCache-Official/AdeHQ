"use client";

import { Card } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/common";

export function AdminComingSoon({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div>
      <AdminPageHeader title={title} subtitle={subtitle} icon={icon} />
      <Card className="p-8 text-center">
        <p className="text-sm font-medium text-ink">Coming soon</p>
        <p className="mt-2 text-sm text-ink-3">
          This module is reserved in the admin navigation and will ship in a later stage.
        </p>
      </Card>
    </div>
  );
}
