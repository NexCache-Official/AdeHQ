"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { canManageAiEmployees } from "@/lib/workspace/permissions";

export default function WorkforceNewPage() {
  const router = useRouter();
  const { state, hydrated } = useStore();
  const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role;

  useEffect(() => {
    if (!hydrated) return;
    if (canManageAiEmployees(myRole)) {
      router.replace("/hire");
    } else {
      router.replace("/workforce");
    }
  }, [hydrated, myRole, router]);

  return null;
}
