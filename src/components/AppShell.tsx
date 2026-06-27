"use client";

import {
  createContext,
  useCallback,
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
import { HireEmployeeModal } from "./HireEmployeeModal";
import { CreateRoomModal } from "./CreateRoomModal";
import { LoadingState } from "./States";

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
  const { state, hydrated } = useStore();
  const router = useRouter();
  const pathname = usePathname();

  const [commandOpen, setCommandOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);

  // Auth + onboarding gating
  useEffect(() => {
    if (!hydrated) return;
    if (!state.user) {
      router.replace("/login");
    } else if (!state.onboardingComplete) {
      router.replace("/onboarding");
    }
  }, [hydrated, state.user, state.onboardingComplete, router]);

  // Global ⌘K
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
      openHire: () => setHireOpen(true),
      openCreateRoom: () => setRoomOpen(true),
    }),
    [],
  );

  if (!hydrated) return <LoadingState full />;
  if (!state.user || !state.onboardingComplete) return <LoadingState full label="Redirecting…" />;

  return (
    <ShellUIContext.Provider value={ui}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main key={pathname} className="flex-1 overflow-y-auto">
            <div className="animate-fade-in">{children}</div>
          </main>
        </div>
      </div>

      <CommandBar open={commandOpen} onClose={() => setCommandOpen(false)} onHire={ui.openHire} onCreateRoom={ui.openCreateRoom} />
      <HireEmployeeModal open={hireOpen} onClose={() => setHireOpen(false)} />
      <CreateRoomModal open={roomOpen} onClose={() => setRoomOpen(false)} />
    </ShellUIContext.Provider>
  );
}
