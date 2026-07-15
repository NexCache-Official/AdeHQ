"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/demo-store";
import {
  canManageMembers,
  canManageWorkspaceSettings,
  canViewBilling,
  canViewUsage,
} from "@/lib/workspace/permissions";
import { PageContainer } from "@/components/Page";
import { Bell, CreditCard, Gauge, Settings as SettingsIcon, Timer, Users, UserCircle } from "lucide-react";

const NAV = [
  { href: "/settings", label: "Profile", icon: UserCircle, show: () => true },
  { href: "/settings/members", label: "Members", icon: Users, show: canManageMembers },
  { href: "/settings/notifications", label: "Notifications", icon: Bell, show: () => true },
  { href: "/settings/usage", label: "Usage", icon: Gauge, show: canViewUsage },
  { href: "/settings/ai-work-hours", label: "AI Work Hours", icon: Timer, show: () => true },
  { href: "/settings/billing", label: "Billing", icon: CreditCard, show: canViewBilling },
  {
    href: "/settings/workspace",
    label: "Workspace",
    icon: SettingsIcon,
    show: canManageWorkspaceSettings,
  },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state } = useStore();
  const role = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role ?? "member";

  const items = NAV.filter((item) => item.show(role));

  return (
    <PageContainer>
      <nav className="mb-6 flex flex-wrap gap-1 border-b border-border-2 pb-2">
        {items.map((item) => {
          const active =
            item.href === "/settings"
              ? pathname === "/settings"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent-soft text-accent-d"
                  : "text-ink-2 hover:bg-muted hover:text-ink",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </PageContainer>
  );
}
