"use client";

import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/Page";
import { HireEmployeeModal } from "@/components/HireEmployeeModal";
import { EmptyState } from "@/components/States";
import { UserPlus } from "lucide-react";

export default function HireRoutePage() {
  const router = useRouter();
  return (
    <PageContainer>
      <EmptyState
        icon={UserPlus}
        title="Hire an AI employee"
        description="Choose a role template, customize the employee, give them tools and permissions, then add them to a room."
        action={{ label: "Back to workforce", onClick: () => router.push("/workforce") }}
      />
      <HireEmployeeModal open onClose={() => router.push("/workforce")} />
    </PageContainer>
  );
}
