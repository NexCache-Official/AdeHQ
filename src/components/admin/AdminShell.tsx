"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { authHeaders } from "@/lib/api/auth-client";
import { LoadingState } from "@/components/States";
import type { PlatformAdminRole } from "@/lib/admin/types";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bot,
  Clock,
  CreditCard,
  Database,
  FileText,
  FlaskConical,
  Gauge,
  Globe,
  HardDrive,
  LifeBuoy,
  ListChecks,
  Rocket,
  ScrollText,
  Cpu,
  KeyRound,
  Shield,
  ShieldAlert,
  Siren,
  Ticket,
  ToggleLeft,
  Users,
  Wrench,
} from "lucide-react";
import { BrandMark } from "@/components/brand/Brand";

type AdminIdentity = {
  role: PlatformAdminRole;
  email: string;
};

const AdminContext = createContext<AdminIdentity | null>(null);

export function usePlatformAdmin(): AdminIdentity {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("usePlatformAdmin must be used within AdminShell");
  return ctx;
}

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  stage?: string;
  superAdminOnly?: boolean;
};

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Cockpit",
    items: [
      { href: "/admin", label: "Command Center", icon: Gauge },
      { href: "/admin/growth", label: "Growth", icon: Rocket },
      { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
    ],
  },
  {
    title: "Customers",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/workspaces", label: "Workspaces", icon: Database },
      { href: "/admin/support", label: "Support", icon: LifeBuoy },
    ],
  },
  {
    title: "AI Operations",
    items: [
      { href: "/admin/usage", label: "Usage & Cost", icon: BarChart3 },
      { href: "/admin/work-hours", label: "Work Hours", icon: Clock },
      { href: "/admin/models", label: "Models", icon: Activity },
      { href: "/admin/runtime", label: "Runtime", icon: Cpu },
      { href: "/admin/browser-research", label: "Browser Research", icon: Globe },
      { href: "/admin/ai-employees", label: "AI Employees", icon: Bot },
      { href: "/admin/tool-runs", label: "Tool Runs", icon: Wrench },
      { href: "/admin/files-storage", label: "Files & Storage", icon: HardDrive },
    ],
  },
  {
    title: "Commercial",
    items: [
      { href: "/admin/plans", label: "Plans", icon: ListChecks },
      { href: "/admin/promo-codes", label: "Promo Codes", icon: Ticket },
      { href: "/admin/billing", label: "Billing", icon: CreditCard },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/admin/feature-flags", label: "Feature Flags", icon: ToggleLeft },
      { href: "/admin/maintenance", label: "Maintenance", icon: Wrench },
      { href: "/admin/incidents", label: "Incidents", icon: Siren },
      { href: "/admin/experiments", label: "Experiments", icon: FlaskConical },
      { href: "/admin/jobs", label: "Jobs", icon: FileText },
      { href: "/admin/security", label: "Security", icon: ShieldAlert },
      { href: "/admin/provider-credentials", label: "Provider Credentials", icon: KeyRound, superAdminOnly: true },
      { href: "/admin/vercel-env", label: "Vercel Environment", icon: KeyRound, superAdminOnly: true },
      { href: "/admin/system-health", label: "System Health", icon: Activity },
    ],
  },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [status, setStatus] = useState<"checking" | "denied" | "ok">("checking");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/admin/me", { headers });
        if (cancelled) return;
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const body = await res.json();
        if (body?.isPlatformAdmin) {
          setIdentity({ role: body.role, email: body.email });
          setStatus("ok");
        } else {
          setStatus("denied");
        }
      } catch {
        if (!cancelled) router.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-app">
        <LoadingState label="Verifying platform access…" />
      </div>
    );
  }

  if (status === "denied" || !identity) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-app px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Shield className="h-7 w-7" />
        </div>
        <h1 className="text-lg font-semibold text-ink">AdeHQ Control</h1>
        <p className="max-w-sm text-sm text-ink-3">
          This area is restricted to AdeHQ platform operators. Your account does not
          have platform admin access.
        </p>
        <Link
          href="/"
          className="mt-2 inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" /> Back to AdeHQ
        </Link>
      </div>
    );
  }

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <AdminContext.Provider value={identity}>
      <div className="flex h-screen overflow-hidden bg-app">
        <aside className="hidden w-[232px] shrink-0 flex-col border-r border-[var(--rail-edge)] bg-rail lg:flex">
          <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-white shadow-glow">
              <BrandMark size={16} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[var(--rail-ink)]">
                AdeHQ Control
              </p>
              <p className="truncate text-[10.5px] text-[var(--rail-ink-3)]">
                Platform cockpit
              </p>
            </div>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title} className="mb-1.5">
                <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--rail-ink-3)]">
                  {section.title}
                </p>
                {section.items
                  .filter((item) => !item.superAdminOnly || identity.role === "super_admin")
                  .map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13px] transition-colors",
                        isActive(item.href)
                          ? "bg-[var(--rail-active)] font-medium text-[var(--rail-ink)]"
                          : "text-[var(--rail-ink-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]",
                      )}
                    >
                      <item.icon className="h-[15px] w-[15px] shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.stage && (
                        <span className="ml-auto shrink-0 rounded-full border border-[var(--rail-border)] px-1.5 py-px text-[9px] uppercase tracking-wide text-[var(--rail-ink-3)]">
                          {item.stage}
                        </span>
                      )}
                    </Link>
                  ))}
              </div>
            ))}
          </nav>

          <div className="border-t border-[var(--rail-edge)] px-4 py-3">
            <p className="truncate text-[11.5px] font-medium text-[var(--rail-ink-2)]">
              {identity.email}
            </p>
            <p className="text-[10.5px] uppercase tracking-wide text-[var(--rail-ink-3)]">
              {identity.role.replace("_", " ")}
            </p>
            <Link
              href="/"
              className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-[var(--rail-ink-3)] transition-colors hover:text-[var(--rail-ink)]"
            >
              <ArrowLeft className="h-3 w-3" /> Back to AdeHQ
            </Link>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1200px] px-6 py-8">{children}</div>
        </main>
      </div>
    </AdminContext.Provider>
  );
}
