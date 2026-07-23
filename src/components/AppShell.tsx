"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { Sidebar } from "./Sidebar";
import { CommandBar } from "./CommandBar";
import { CreateRoomModal } from "./CreateRoomModal";
import { LoadingState } from "./States";
import { DebugProvider, useDebugTraceListener } from "./DebugProvider";
import { ResizablePane } from "./layout/ResizablePane";
import { cn } from "@/lib/utils";
import { DebugTerminal } from "./DebugTerminal";
import { JUMP_TO_SOURCE_EVENT, type JumpSource } from "@/lib/navigation/jump-to-source";
import { crmEntityHref } from "@/lib/crm/client";
import { isPasswordRecoveryPending } from "@/lib/auth/recovery";
import { PANE_PRESETS } from "@/lib/layout/pane-prefs";
import { IncomingCallProvider } from "./calls/IncomingCallProvider";

type ShellUI = {
  openCommand: () => void;
  openHire: () => void;
  openCreateRoom: () => void;
};

const ShellUIContext = createContext<ShellUI | null>(null);

export function useShellUI() {
  const ctx = useContext(ShellUIContext);
  if (!ctx) throw new Error("useShellUI must be used within AppShell");
  return ctx;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <DebugProvider>
      <IncomingCallProvider>
        <AppShellInner>{children}</AppShellInner>
      </IncomingCallProvider>
    </DebugProvider>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  useDebugTraceListener();
  const { state, hydrated, workspaceTransitioning } = useStore();
  const router = useRouter();
  const pathname = usePathname();

  const [commandOpen, setCommandOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform/status");
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (body.maintenanceMode && body.maintenanceMessage) {
          setMaintenanceMessage(String(body.maintenanceMessage));
        } else if (body.maintenanceMode) {
          setMaintenanceMessage("AdeHQ is in maintenance mode. Some features may be unavailable.");
        }
      } catch {
        // ignore — fail open for banner
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (isPasswordRecoveryPending()) {
      router.replace("/reset-password");
      return;
    }
    if (!state.user) {
      router.replace("/login");
      return;
    }
    // Never bounce mid-switch — a transient false flag was sending completed HQs to /onboarding.
    if (workspaceTransitioning) return;
    if (!state.onboardingComplete) {
      router.replace("/onboarding");
    }
  }, [hydrated, state.user, state.onboardingComplete, workspaceTransitioning, router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const onJump = (event: Event) => {
      const source = (event as CustomEvent<JumpSource>).detail;
      if (source.type === "crm" && source.crmEntity && source.entityId) {
        router.push(crmEntityHref(source.crmEntity, source.entityId));
        return;
      }
      if (source.type === "artifact" && source.entityId) {
        router.push(`/drive?artifact=${encodeURIComponent(source.entityId)}`);
      }
    };
    window.addEventListener(JUMP_TO_SOURCE_EVENT, onJump);
    return () => window.removeEventListener(JUMP_TO_SOURCE_EVENT, onJump);
  }, [router]);

  const ui = useMemo<ShellUI>(
    () => ({
      openCommand: () => setCommandOpen(true),
      openHire: () => router.push(`/hire?entry=top_nav&fresh=${Date.now()}`),
      openCreateRoom: () => setRoomOpen(true),
    }),
    [router],
  );

  const isImmersive =
    (pathname.startsWith("/rooms/") && pathname !== "/rooms") ||
    pathname.startsWith("/inbox") ||
    pathname.startsWith("/calls");

  if (!hydrated) return <LoadingState full />;
  if (workspaceTransitioning) return <LoadingState full label="Switching workspace…" />;
  if (!state.user || !state.onboardingComplete) return <LoadingState full label="Redirecting…" />;

  return (
    <ShellUIContext.Provider value={ui}>
      <div className="flex h-screen overflow-hidden bg-canvas text-ink">
        <ResizablePane
          id={PANE_PRESETS.appRail.id}
          side="left"
          limits={PANE_PRESETS.appRail}
          className="hidden lg:flex"
          collapsedLabel="Workspace"
        >
          <Sidebar />
        </ResizablePane>
        <div className="flex min-w-0 flex-1 flex-col">
          {maintenanceMessage && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
              {maintenanceMessage}
            </div>
          )}
          <main key={pathname} className="min-h-0 flex-1 overflow-hidden">
            <div
              className={cn(
                "h-full",
                // Skip the enter animation on immersive surfaces (calls especially) —
                // fade-up made the call canvas look like it scaled up from a small tile.
                !isImmersive && "fade-up",
                isImmersive ? "overflow-hidden" : "overflow-y-auto",
              )}
            >
              {children}
            </div>
          </main>
          <DebugTerminal />
        </div>
      </div>

      <CommandBar
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onHire={ui.openHire}
        onCreateRoom={ui.openCreateRoom}
      />
      <CreateRoomModal open={roomOpen} onClose={() => setRoomOpen(false)} />
    </ShellUIContext.Provider>
  );
}
