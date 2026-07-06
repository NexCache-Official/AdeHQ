"use client";

import { AdminPageHeader } from "@/components/admin/common";
import { AiRuntimePanel } from "@/components/AiRuntimePanel";
import { Cpu } from "lucide-react";

export default function AdminRuntimePage() {
  return (
    <div>
      <AdminPageHeader
        title="Runtime"
        subtitle="Provider diagnostics, model routing, and runtime mode — platform operators only."
        icon={<Cpu className="h-5 w-5" />}
      />
      <AiRuntimePanel />
    </div>
  );
}
