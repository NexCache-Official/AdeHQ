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
import { Topbar } from "./Topbar";
import { CommandBar } from "./CommandBar";
import { CreateRoomModal } from "./CreateRoomModal";
import { LoadingState } from "./States";
import { DebugProvider, useDebugTraceListener } from "./DebugProvider";
import { cn } from "@/lib/utils";
import { DebugTerminal } from "./DebugTerminal";

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
      <AppShellInner>{children}</AppShellInner>
    </DebugProvider>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  useDebugTraceListener();
  const { state, hydrated } = useStore();
  const router = useRouter();
  const pathname = usePathname();

  const [commandOpen, setCommandOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!state.user) {
      router.replace("/login");
    } else if (!state.onboardingComplete) {
      router.replace("/onboarding");
    }
  }, [hydrated, state.user, state.onboardingComplete, router]);

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

  const ui = useMemo<ShellUI>(
    () => ({
      openCommand: () => setCommandOpen(true),
      openHire: () => router.push("/hire"),
      openCreateRoom: () => setRoomOpen(true),
    }),
    [router],
  );

  const isImmersive = pathname.startsWith("/rooms/") && pathname !== "/rooms";

  if (!hydrated) return <LoadingState full />;
  if (!state.user || !state.onboardingComplete) return <LoadingState full label="Redirecting…" />;

  return (
    <ShellUIContext.Provider value={ui}>
      <div className="flex h-screen overflow-hidden bg-canvas text-ink">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main key={pathname} className="min-h-0 flex-1 overflow-hidden">
            <div
              className={cn(
                "fade-up h-full",
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
