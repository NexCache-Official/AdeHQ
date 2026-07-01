"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { buildDemoState, TOOL_CATALOG } from "@/lib/demo";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import {
  clearActiveWorkspaceId,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from "@/lib/active-workspace";
import {
  AIEmployee,
  Approval,
  Call,
  CallTranscriptLine,
  DemoState,
  MemoryEntry,
  ProviderId,
  ProjectRoom,
  RoomMessage,
  Settings,
  Task,
  WorkspaceMemberRole,
  WorkLogEvent,
} from "./types";
import { getEmailRedirectUrl, setAuthNextPath } from "@/lib/auth/callback-session";
import { isEmailConfirmed } from "@/lib/auth/session";
import { mayaWelcomeMessage } from "@/lib/hiring/maya";
import { isMayaEmployee, isSystemEmployee, mergeMayaIntoState, mayaEmployeeStatus, buildMayaDmRoom, ensureMayaDmTopicsInState, dedupeMayaDmRooms, mergeEmployeesById } from "@/lib/maya-employee";
import { isGroupChannel } from "@/lib/rooms";
import { nowISO, uid } from "./utils";
import { SUPABASE_WORKSPACE_TABLES } from "./supabase/config";
import { supabase } from "./supabase/client";
import {
  buildFreshWorkspaceState,
  acceptWorkspaceInvitation as acceptWorkspaceInvitationRemote,
  createWorkspaceInvitation as createWorkspaceInvitationRemote,
  bootstrapWorkspaceRemote,
  declineWorkspaceInvitation as declineWorkspaceInvitationRemote,
  revokeWorkspaceInvitation as revokeWorkspaceInvitationRemote,
  deleteEmployee,
  deleteRoomMember,
  loadWorkspaceState,
  listUserWorkspaces,
  persistApproval,
  persistCall,
  persistCallTranscriptLine,
  persistEmployee,
  persistMemory,
  persistMessage,
  persistProfile,
  persistRoom,
  persistRoomMetadata,
  persistRoomMember,
  persistTask,
  persistWorkLog,
  persistWorkspace,
  persistWorkspaceToolStatus,
  resetWorkspaceToState,
  type UserWorkspaceSummary,
} from "./supabase/persistence";

type BackendMode = "supabase" | "demo";

function buildSignedOutState(): DemoState {
  return {
    version: buildDemoState().version,
    user: null,
    workspace: { id: "", name: "", plan: "Free", workspaceMode: "real" },
    workspaceMembers: [],
    workspaceInvitations: [],
    onboardingComplete: false,
    employees: [],
    rooms: [],
    topics: [],
    topicMembers: [],
    tasks: [],
    memory: [],
    approvals: [],
    workLog: [],
    tools: TOOL_CATALOG.map((tool) => ({ ...tool })),
    calls: [],
    settings: { mode: "live", activeProvider: "siliconflow" },
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return formatSupabaseError(error.message, error);
  if (typeof error === "string") return formatSupabaseError(error);
  if (error && typeof error === "object") {
    const e = error as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint].filter(Boolean);
    if (parts.length) return formatSupabaseError(parts.join(" — "));
  }
  return "Something went wrong.";
}

function formatSupabaseError(message: string, cause?: unknown): string {
  const lower = message.toLowerCase();
  if (lower.includes("workspace_mode") && lower.includes("schema cache")) {
    return "Database schema is out of date. In Supabase SQL Editor, run supabase/migrations/20250627120000_align_production_schema.sql then try again.";
  }
  if (lower.includes("schema cache") && lower.includes("could not find")) {
    return `Database schema mismatch: ${message}. Run the latest migration SQL in Supabase, then reload the app.`;
  }
  if (cause instanceof Error && cause.message !== message) {
    return message;
  }
  return message;
}

// ---------------------------------------------------------------------------

type StoreActions = {
  // auth + onboarding
  signup: (
    user: { name: string; email: string },
    workspaceName: string,
    password: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  login: (email: string, password: string) => Promise<{ onboardingComplete: boolean }>;
  bootstrapWorkspace: (workspaceName?: string) => Promise<void>;
  finishOnboarding: (payload: {
    workspaceName: string;
    employee: AIEmployee;
    room: ProjectRoom;
    workLog: WorkLogEvent;
  }) => Promise<{ roomId: string }>;
  flushRemote: () => Promise<void>;
  loginDemo: () => void;
  logout: () => Promise<void>;
  clearError: () => void;
  completeOnboarding: () => void;
  updateProfile: (patch: { name?: string; email?: string; workspaceName?: string }) => void;

  // employees
  hireEmployee: (employee: AIEmployee) => AIEmployee;
  updateEmployee: (id: string, patch: Partial<AIEmployee>) => void;
  removeEmployee: (id: string) => void;

  // rooms
  createRoom: (room: Partial<ProjectRoom> & { name: string }) => ProjectRoom;
  openOrCreateDM: (employeeId: string) => ProjectRoom;
  updateRoom: (id: string, patch: Partial<ProjectRoom>) => void;
  addEmployeeToRoom: (roomId: string, employeeId: string) => void;
  removeEmployeeFromRoom: (roomId: string, employeeId: string) => void;
  markRoomRead: (roomId: string) => void;

  // messages
  addMessage: (roomId: string, msg: Omit<RoomMessage, "id" | "roomId" | "createdAt"> & { id?: string; createdAt?: string }) => RoomMessage;
  addLocalMessage: (roomId: string, msg: Omit<RoomMessage, "id" | "roomId" | "createdAt"> & { id?: string; createdAt?: string }) => RoomMessage;
  removeLocalMessage: (roomId: string, messageId: string) => void;
  updateMessage: (roomId: string, messageId: string, patch: Partial<RoomMessage>) => void;
  refreshTopics: (roomId: string) => Promise<void>;
  upsertTopic: (topic: import("@/lib/types").RoomTopic) => void;
  setTopicSummary: (topicId: string, summary: string) => void;
  removeTopicPermanently: (roomId: string, topicId: string) => void;

  // tasks
  createTask: (task: Partial<Task> & { title: string; roomId: string }) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;

  // memory
  createMemory: (m: Partial<MemoryEntry> & { title: string; content: string; roomId: string }) => MemoryEntry;
  updateMemory: (id: string, patch: Partial<MemoryEntry>) => void;

  // approvals
  createApproval: (a: Partial<Approval> & { title: string; roomId: string; requestedBy: string }) => Approval;
  resolveApproval: (id: string, approved: boolean) => void;

  // work log
  addWorkLog: (e: Partial<WorkLogEvent> & { action: string; roomId: string; employeeId: string }) => WorkLogEvent;

  // calls
  startCall: (call: Call) => Call;
  addTranscriptLine: (callId: string, line: CallTranscriptLine) => void;
  setSpeaking: (callId: string, speakerId: string | null) => void;
  addActionItem: (callId: string, item: string) => void;
  endCall: (callId: string) => void;

  // settings
  updateSettings: (patch: Partial<Settings>) => void;
  // workspace humans
  inviteWorkspaceMember: (email: string, role: WorkspaceMemberRole) => Promise<void>;
  acceptWorkspaceInvitation: (id: string) => Promise<void>;
  declineWorkspaceInvitation: (id: string) => Promise<void>;
  revokeWorkspaceInvitation: (id: string) => Promise<void>;

  // tools
  setToolStatus: (toolId: string, status: DemoState["tools"][number]["status"]) => void;

  // misc
  resetDemoData: () => void;
  clearWorkspaceData: () => void;
  switchWorkspace: (workspaceId: string) => Promise<void>;
};

type StoreValue = {
  state: DemoState;
  hydrated: boolean;
  backend: BackendMode;
  error: string | null;
  userWorkspaces: UserWorkspaceSummary[];
  actions: StoreActions;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState>(() => buildSignedOutState());
  const [hydrated, setHydrated] = useState(false);
  const [backend, setBackend] = useState<BackendMode>("demo");
  const [error, setError] = useState<string | null>(null);
  const [userWorkspaces, setUserWorkspaces] = useState<UserWorkspaceSummary[]>([]);
  const stateRef = useRef(state);
  const backendRef = useRef<BackendMode>(backend);
  const authUserRef = useRef<User | null>(null);
  const authBusyRef = useRef(false);
  const remoteQueueRef = useRef<Promise<void>>(Promise.resolve());

  stateRef.current = state;
  backendRef.current = backend;

  const setRemoteState = useCallback((loaded: DemoState) => {
    setState((previous) => {
      const merged = mergeMayaIntoState(
        {
          ...loaded,
          employees: mergeEmployeesById(previous.employees, loaded.employees),
          settings: previous.settings ?? loaded.settings,
        },
        loaded.user?.id,
        loaded.user?.name
          ? mayaWelcomeMessage(loaded.user.name.split(" ")[0] ?? "there")
          : undefined,
      );
      stateRef.current = merged;
      return merged;
    });
  }, []);

  const loadRemote = useCallback(
    async (user: User, preferredWorkspaceId?: string) => {
      if (!isEmailConfirmed(user)) {
        await supabase.auth.signOut();
        authUserRef.current = null;
        setBackend("demo");
        setState(buildSignedOutState());
        setHydrated(true);
        throw new Error("Email not confirmed");
      }

      authUserRef.current = user;
      const workspaceId = preferredWorkspaceId ?? getActiveWorkspaceId() ?? undefined;
      const loaded = await loadWorkspaceState(user, workspaceId);
      if (loaded.workspace.id) setActiveWorkspaceId(loaded.workspace.id);
      const workspaces = await listUserWorkspaces(user.id);
      setUserWorkspaces(workspaces);
      setRemoteState(loaded);
      setBackend("supabase");
      setHydrated(true);
      setError(null);
    },
    [setRemoteState],
  );

  const flushRemote = useCallback(async () => {
    await remoteQueueRef.current.catch(() => undefined);
  }, []);

  const runRemote = useCallback((operation: (workspaceId: string) => Promise<void>) => {
    if (backendRef.current !== "supabase") return;
    remoteQueueRef.current = remoteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const workspaceId = stateRef.current.workspace.id;
        if (!workspaceId) return;
        await operation(workspaceId);
      })
      .catch((err) => {
        const message = errorMessage(err);
        setError(message);
        console.error("[AdeHQ Supabase]", err);
      });
  }, []);

  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (data.session?.user) {
          if (!isEmailConfirmed(data.session.user)) {
            await supabase.auth.signOut();
            if (!active) return;
            authUserRef.current = null;
            setBackend("demo");
            setState(buildSignedOutState());
          } else {
            authUserRef.current = data.session.user;
            const preferredId = getActiveWorkspaceId() ?? undefined;
            const loaded = await loadWorkspaceState(data.session.user, preferredId);
            if (!active) return;
            if (loaded.workspace.id) setActiveWorkspaceId(loaded.workspace.id);
            const workspaces = await listUserWorkspaces(data.session.user.id);
            setUserWorkspaces(workspaces);
            setRemoteState(loaded);
            setBackend("supabase");
          }
        } else {
          if (!active) return;
          authUserRef.current = null;
          setBackend("demo");
          setState(buildSignedOutState());
        }
        setError(null);
      } catch (err) {
        if (!active) return;
        const message = errorMessage(err);
        setError(message);
        setBackend("demo");
        setState(buildSignedOutState());
        if (message.includes("schema") || message.includes("workspace_mode")) {
          void supabase.auth.signOut();
          authUserRef.current = null;
        }
      } finally {
        if (active) setHydrated(true);
      }
    };

    void hydrate();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || authBusyRef.current) return;

      if (event === "SIGNED_OUT" || !session?.user) {
        authUserRef.current = null;
        setBackend("demo");
        setState(buildSignedOutState());
        setHydrated(true);
        return;
      }

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void loadRemote(session.user);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadRemote, setRemoteState]);

  useEffect(() => {
    if (!hydrated || backend !== "supabase" || !state.user || !state.workspace.id) return;

    const workspaceId = state.workspace.id;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        const user = authUserRef.current;
        if (user) void loadRemote(user);
      }, 250);
    };

    let channel = supabase.channel(`workspace:${workspaceId}`);
    SUPABASE_WORKSPACE_TABLES.forEach((table) => {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `workspace_id=eq.${workspaceId}`,
        },
        refresh,
      );
    });

    channel = channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspaces",
          filter: `id=eq.${workspaceId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${state.user.id}`,
        },
        refresh,
      );

    void channel.subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [backend, hydrated, loadRemote, state.user, state.workspace.id]);

  const actions = useMemo<StoreActions>(() => {
    const set = (fn: (s: DemoState) => DemoState) => {
      setState((current) => {
        const next = fn(current);
        stateRef.current = next;
        return next;
      });
    };

    const refreshTopicsForRoom = async (roomId: string) => {
      const room = stateRef.current.rooms.find((entry) => entry.id === roomId);
      const isMayaDm =
        room?.kind === "dm" &&
        stateRef.current.employees.some(
          (employee) => isMayaEmployee(employee) && employee.id === room.dmEmployeeId,
        );

      if (backendRef.current === "supabase") {
        try {
          const { authHeaders } = await import("@/lib/api/auth-client");
          const headers = await authHeaders();
          const response = await fetch(`/api/rooms/${roomId}/topics`, { headers });
          if (response.ok) {
            const payload = await response.json();
            set((current) => {
              const merged = {
                ...current,
                topics: [
                  ...current.topics.filter((topic) => topic.roomId !== roomId),
                  ...(payload.topics ?? []),
                ],
                topicMembers: [
                  ...current.topicMembers.filter((member) => member.roomId !== roomId),
                  ...(payload.members ?? []),
                ],
              };
              return isMayaDm ? ensureMayaDmTopicsInState(merged, current.user?.id) : merged;
            });
            return;
          }
        } catch {
          // fall through to local ensure for Maya
        }
      }

      if (isMayaDm) {
        set((current) => ensureMayaDmTopicsInState(current, current.user?.id));
      }
    };

    const ensureMayaDmRemote = async (roomId: string) => {
      if (backendRef.current !== "supabase") return;
      try {
        const { authHeaders } = await import("@/lib/api/auth-client");
        const headers = await authHeaders();
        await fetch("/api/workspaces/ensure-maya", { method: "POST", headers });
        await refreshTopicsForRoom(roomId);
      } catch {
        set((current) => ensureMayaDmTopicsInState(current, current.user?.id));
      }
    };

    return {
      signup: async (user, workspaceName, password) => {
        if (!password) throw new Error("Password is required.");
        authBusyRef.current = true;
        try {
          setAuthNextPath("/onboarding");
          const { data, error: signupError } = await supabase.auth.signUp({
            email: user.email,
            password,
            options: {
              emailRedirectTo: getEmailRedirectUrl(),
              data: {
                name: user.name,
                workspace_name: workspaceName,
              },
            },
          });
          if (signupError) throw signupError;
          if (!data.user) throw new Error("Unable to create account.");

          if (!data.session || !isEmailConfirmed(data.user)) {
            if (data.session) await supabase.auth.signOut();
            return { needsEmailConfirmation: true };
          }

          authUserRef.current = data.user;
          await loadRemote(data.user);
          return { needsEmailConfirmation: false };
        } finally {
          authBusyRef.current = false;
        }
      },

      login: async (email, password) => {
        authBusyRef.current = true;
        try {
          const { data, error: loginError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (loginError) throw loginError;
          if (!data.user) throw new Error("No user returned from Supabase.");
          if (!isEmailConfirmed(data.user)) {
            await supabase.auth.signOut();
            throw new Error("Email not confirmed");
          }
          await loadRemote(data.user);
          return { onboardingComplete: stateRef.current.onboardingComplete };
        } finally {
          authBusyRef.current = false;
        }
      },

      bootstrapWorkspace: async (workspaceName) => {
        authBusyRef.current = true;
        try {
          const user = authUserRef.current;
          if (!user) throw new Error("Sign in to create a workspace.");
          if (!isEmailConfirmed(user)) {
            throw new Error("Confirm your email before creating a workspace.");
          }
          const name =
            workspaceName?.trim() ||
            stateRef.current.workspace.name ||
            (typeof user.user_metadata?.workspace_name === "string"
              ? user.user_metadata.workspace_name
              : "My AI Workspace");
          await bootstrapWorkspaceRemote(name);
          await loadRemote(user);
        } finally {
          authBusyRef.current = false;
        }
      },

      finishOnboarding: async ({ workspaceName, employee, room, workLog }) => {
        authBusyRef.current = true;
        try {
          const user = authUserRef.current;
          if (!user) throw new Error("Sign in to finish onboarding.");

          if (backendRef.current !== "supabase") {
            set((s) => ({
              ...s,
              onboardingComplete: true,
              employees: [...s.employees, employee],
              rooms: [room, ...s.rooms.filter((existing) => existing.id !== room.id)],
              workLog: [workLog, ...s.workLog],
            }));
            return { roomId: room.id };
          }

          if (!isEmailConfirmed(user)) {
            throw new Error("Confirm your email before creating a workspace.");
          }

          const name =
            workspaceName.trim() ||
            stateRef.current.workspace.name ||
            (typeof user.user_metadata?.workspace_name === "string"
              ? user.user_metadata.workspace_name
              : "My AI Workspace");

          const bootstrapped = await bootstrapWorkspaceRemote(name);
          const workspaceId = bootstrapped.workspaceId;

          await persistRoom(workspaceId, room);
          await Promise.all([
            ...room.humans.map((id) => persistRoomMember(workspaceId, room.id, "human", id)),
            ...room.aiEmployees.map((id) => persistRoomMember(workspaceId, room.id, "ai", id)),
          ]);
          await Promise.all(room.messages.map((message) => persistMessage(workspaceId, message)));
          await persistEmployee(workspaceId, employee);
          if (employee.defaultRoomId) {
            await persistRoomMember(workspaceId, employee.defaultRoomId, "ai", employee.id);
          }
          await persistWorkLog(workspaceId, workLog);
          await persistWorkspace(workspaceId, { onboardingComplete: true });

          await loadRemote(user, workspaceId);
          return { roomId: room.id };
        } finally {
          authBusyRef.current = false;
        }
      },

      flushRemote,

      loginDemo: () => {
        if (!ENABLE_DEMO_MODE) return;
        authBusyRef.current = true;
        authUserRef.current = null;
        setBackend("demo");
        setState(buildDemoState());
        setHydrated(true);
        setError(null);
        void supabase.auth.signOut().finally(() => {
          authBusyRef.current = false;
        });
      },

      logout: async () => {
        authBusyRef.current = true;
        try {
          await supabase.auth.signOut();
          authUserRef.current = null;
          setBackend("demo");
          setUserWorkspaces([]);
          clearActiveWorkspaceId();
          setState(buildSignedOutState());
          setHydrated(true);
          setError(null);
        } finally {
          authBusyRef.current = false;
        }
      },

      clearError: () => setError(null),

      completeOnboarding: () => {
        set((s) => ({ ...s, onboardingComplete: true }));
        runRemote((workspaceId) => persistWorkspace(workspaceId, { onboardingComplete: true }));
      },

      updateProfile: (patch) => {
        const current = stateRef.current;
        const nextUser = current.user
          ? {
              ...current.user,
              name: patch.name ?? current.user.name,
              email: patch.email ?? current.user.email,
            }
          : current.user;
        const nextWorkspace = patch.workspaceName
          ? { ...current.workspace, name: patch.workspaceName }
          : current.workspace;

        set((s) => ({
          ...s,
          user: nextUser,
          workspace: nextWorkspace,
        }));

        runRemote(async (workspaceId) => {
          if (nextUser) await persistProfile(nextUser.id, nextUser);
          if (patch.workspaceName) await persistWorkspace(workspaceId, { name: patch.workspaceName });
        });
      },

      hireEmployee: (employee) => {
        const current = stateRef.current;
        const defaultRoom = employee.defaultRoomId
          ? current.rooms.find((room) => room.id === employee.defaultRoomId)
          : undefined;
        const validDefaultRoomId =
          defaultRoom && isGroupChannel(defaultRoom) ? defaultRoom.id : undefined;
        const safeEmployee =
          validDefaultRoomId === employee.defaultRoomId
            ? employee
            : { ...employee, defaultRoomId: validDefaultRoomId };

        const updatedRooms = validDefaultRoomId
          ? current.rooms.map((room) =>
              room.id === validDefaultRoomId && !room.aiEmployees.includes(safeEmployee.id)
                ? { ...room, aiEmployees: [...room.aiEmployees, safeEmployee.id], updatedAt: nowISO() }
                : room,
            )
          : current.rooms;
        const assignedRoom = validDefaultRoomId
          ? updatedRooms.find((room) => room.id === validDefaultRoomId)
          : undefined;

        set((s) => ({
          ...s,
          employees: [...s.employees, safeEmployee],
          rooms: updatedRooms,
        }));

        runRemote(async (workspaceId) => {
          if (assignedRoom) await persistRoom(workspaceId, assignedRoom);
          await persistEmployee(workspaceId, safeEmployee);
          if (validDefaultRoomId) {
            await persistRoomMember(workspaceId, validDefaultRoomId, "ai", safeEmployee.id);
          }
        });

        return safeEmployee;
      },

      updateEmployee: (id, patch) => {
        const current = stateRef.current.employees.find((e) => e.id === id);
        if (!current) return;
        const safePatch = isMayaEmployee(current) ? { ...patch, status: mayaEmployeeStatus() } : patch;
        const updated = { ...current, ...safePatch };
        set((s) => ({
          ...s,
          employees: s.employees.map((e) => (e.id === id ? updated : e)),
        }));
        runRemote((workspaceId) => persistEmployee(workspaceId, updated));
      },

      removeEmployee: (id) => {
        const current = stateRef.current;
        const target = current.employees.find((e) => e.id === id);
        if (target && isSystemEmployee(target)) {
          setError("Maya is a permanent workspace guide and cannot be removed.");
          return;
        }
        const roomsWithEmployee = current.rooms.filter((room) => room.aiEmployees.includes(id));

        set((s) => ({
          ...s,
          employees: s.employees.filter((e) => e.id !== id),
          rooms: s.rooms.map((r) => ({
            ...r,
            aiEmployees: r.aiEmployees.filter((e) => e !== id),
          })),
        }));

        runRemote(async (workspaceId) => {
          await Promise.all(
            roomsWithEmployee.map((room) => deleteRoomMember(workspaceId, room.id, "ai", id)),
          );
          await deleteEmployee(workspaceId, id);
        });
      },

      createRoom: (room) => {
        const id = room.id ?? uid("room");
        const timestamp = nowISO();
        const created: ProjectRoom = {
          id,
          name: room.name,
          kind: "channel",
          description: room.description ?? "",
          brief: room.brief ?? "",
          humans: room.humans ?? (stateRef.current.user?.id ? [stateRef.current.user.id] : []),
          aiEmployees: room.aiEmployees ?? [],
          messages: room.messages ?? [
            {
              id: uid("msg"),
              roomId: id,
              senderType: "system",
              senderId: "system",
              senderName: "AdeHQ",
              content: `Room created. ${room.name}.`,
              createdAt: timestamp,
            },
          ],
          tasks: room.tasks ?? [],
          memory: room.memory ?? [],
          unread: room.unread ?? 0,
          accent: room.accent ?? "#f97316",
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        set((s) => ({ ...s, rooms: [created, ...s.rooms] }));

        runRemote(async (workspaceId) => {
          await persistRoom(workspaceId, created);
          await Promise.all([
            ...created.humans.map((id) => persistRoomMember(workspaceId, created.id, "human", id)),
            ...created.aiEmployees.map((id) => persistRoomMember(workspaceId, created.id, "ai", id)),
          ]);
          await Promise.all(created.messages.map((message) => persistMessage(workspaceId, message)));
        });

        return created;
      },

      openOrCreateDM: (employeeId) => {
        const s = stateRef.current;
        const employee = s.employees.find((e) => e.id === employeeId);
        const userId = s.user?.id;
        if (!userId) throw new Error("Sign in to open a direct message.");

        const isMaya = employee ? isMayaEmployee(employee) : false;
        if (isMaya) {
          const welcomeContent = s.user?.name
            ? mayaWelcomeMessage(s.user.name.split(" ")[0] ?? "there")
            : mayaWelcomeMessage("there");
          const canonical = buildMayaDmRoom(userId, welcomeContent);
          const existing = s.rooms.find(
            (room) => room.kind === "dm" && room.dmEmployeeId === employeeId,
          );

          if (existing?.id === canonical.id) {
            set((st) =>
              ensureMayaDmTopicsInState(dedupeMayaDmRooms(st), userId),
            );
            void ensureMayaDmRemote(canonical.id);
            return existing;
          }

          set((st) => {
            const withoutDupes = st.rooms.filter(
              (room) => !(room.kind === "dm" && room.dmEmployeeId === employeeId),
            );
            return ensureMayaDmTopicsInState(
              { ...st, rooms: [canonical, ...withoutDupes] },
              userId,
            );
          });

          void ensureMayaDmRemote(canonical.id);

          return canonical;
        }

        const existing = s.rooms.find((r) => r.kind === "dm" && r.dmEmployeeId === employeeId);
        if (existing) return existing;
        const id = uid("dm");
        const timestamp = nowISO();
        const welcomeContent = `This is the start of your direct message with ${employee?.name ?? "your employee"}.`;
        const created: ProjectRoom = {
          id,
          name: employee?.name ?? "Direct message",
          kind: "dm",
          dmEmployeeId: employeeId,
          description: `Direct message with ${employee?.name ?? "an employee"}`,
          brief: employee?.instructions ?? "",
          humans: [userId],
          aiEmployees: employeeId ? [employeeId] : [],
          messages: [
            {
              id: uid("msg"),
              roomId: id,
              senderType: "system",
              senderId: "system",
              senderName: "AdeHQ",
              content: welcomeContent,
              createdAt: timestamp,
            },
          ],
          tasks: [],
          memory: [],
          unread: 0,
          accent: employee?.accent ?? "#6366f1",
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        set((st) => ({ ...st, rooms: [created, ...st.rooms] }));

        runRemote(async (workspaceId) => {
          await persistRoom(workspaceId, created);
          await Promise.all([
            ...created.humans.map((id) => persistRoomMember(workspaceId, created.id, "human", id)),
            ...created.aiEmployees.map((id) => persistRoomMember(workspaceId, created.id, "ai", id)),
          ]);
          await persistMessage(workspaceId, created.messages[0]);
        });

        return created;
      },

      updateRoom: (id, patch) => {
        const current = stateRef.current.rooms.find((room) => room.id === id);
        if (!current) return;
        const updated = { ...current, ...patch, updatedAt: nowISO() };
        set((s) => ({
          ...s,
          rooms: s.rooms.map((r) => (r.id === id ? updated : r)),
        }));
        runRemote((workspaceId) => persistRoomMetadata(workspaceId, updated));
      },

      addEmployeeToRoom: (roomId, employeeId) => {
        const employee = stateRef.current.employees.find((e) => e.id === employeeId);
        if (employee?.metadata?.canBeAssignedToChannels === false) return;
        const current = stateRef.current.rooms.find((room) => room.id === roomId);
        if (!current || !isGroupChannel(current) || current.aiEmployees.includes(employeeId)) return;
        const updated = {
          ...current,
          aiEmployees: [...current.aiEmployees, employeeId],
          updatedAt: nowISO(),
        };
        set((s) => ({
          ...s,
          rooms: s.rooms.map((r) => (r.id === roomId ? updated : r)),
        }));
        runRemote(async (workspaceId) => {
          await persistRoomMember(workspaceId, roomId, "ai", employeeId);
          await persistRoomMetadata(workspaceId, updated);
        });
      },

      removeEmployeeFromRoom: (roomId, employeeId) => {
        const current = stateRef.current.rooms.find((room) => room.id === roomId);
        if (!current) return;
        const updated = {
          ...current,
          aiEmployees: current.aiEmployees.filter((e) => e !== employeeId),
          updatedAt: nowISO(),
        };
        set((s) => ({
          ...s,
          rooms: s.rooms.map((r) => (r.id === roomId ? updated : r)),
        }));
        runRemote(async (workspaceId) => {
          await deleteRoomMember(workspaceId, roomId, "ai", employeeId);
          await persistRoomMetadata(workspaceId, updated);
        });
      },

      markRoomRead: (roomId) => {
        const current = stateRef.current.rooms.find((room) => room.id === roomId);
        if (!current || current.unread === 0) return;
        const updated = { ...current, unread: 0 };
        set((s) => ({
          ...s,
          rooms: s.rooms.map((r) => (r.id === roomId ? updated : r)),
        }));
        runRemote((workspaceId) => persistRoomMetadata(workspaceId, updated));
      },

      addMessage: (roomId, msg) => {
        const created: RoomMessage = {
          id: msg.id ?? uid("msg"),
          roomId,
          topicId: msg.topicId,
          senderType: msg.senderType,
          senderId: msg.senderId,
          senderName: msg.senderName,
          content: msg.content,
          mentions: msg.mentions,
          mentionsJson: msg.mentionsJson,
          artifacts: msg.artifacts,
          agentRunId: msg.agentRunId,
          triggerMessageId: msg.triggerMessageId,
          pending: msg.pending,
          createdAt: msg.createdAt ?? nowISO(),
        };
        const currentRoom = stateRef.current.rooms.find((room) => room.id === roomId);
        const updatedRoom = currentRoom
          ? {
              ...currentRoom,
              messages: [...currentRoom.messages, created],
              updatedAt: nowISO(),
            }
          : undefined;

        set((s) => ({
          ...s,
          rooms: s.rooms.map((r) => (r.id === roomId && updatedRoom ? updatedRoom : r)),
        }));

        runRemote(async (workspaceId) => {
          await persistMessage(workspaceId, created);
        });

        return created;
      },

      addLocalMessage: (roomId, msg) => {
        const created: RoomMessage = {
          id: msg.id ?? uid("msg"),
          roomId,
          topicId: msg.topicId,
          senderType: msg.senderType,
          senderId: msg.senderId,
          senderName: msg.senderName,
          content: msg.content,
          mentions: msg.mentions,
          mentionsJson: msg.mentionsJson,
          artifacts: msg.artifacts,
          agentRunId: msg.agentRunId,
          triggerMessageId: msg.triggerMessageId,
          pending: msg.pending,
          failed: msg.failed,
          createdAt: msg.createdAt ?? nowISO(),
        };
        const currentRoom = stateRef.current.rooms.find((room) => room.id === roomId);
        const updatedRoom = currentRoom
          ? {
              ...currentRoom,
              messages: [...currentRoom.messages, created],
              updatedAt: nowISO(),
            }
          : undefined;

        set((s) => ({
          ...s,
          rooms: s.rooms.map((r) => (r.id === roomId && updatedRoom ? updatedRoom : r)),
        }));

        return created;
      },

      removeLocalMessage: (roomId, messageId) => {
        set((s) => ({
          ...s,
          rooms: s.rooms.map((r) =>
            r.id === roomId
              ? { ...r, messages: r.messages.filter((m) => m.id !== messageId) }
              : r,
          ),
        }));
      },

      updateMessage: (roomId, messageId, patch) => {
        const room = stateRef.current.rooms.find((r) => r.id === roomId);
        const message = room?.messages.find((m) => m.id === messageId);
        if (!room || !message) return;
        const updatedMessage = { ...message, ...patch };
        const updatedRoom = {
          ...room,
          messages: room.messages.map((m) => (m.id === messageId ? updatedMessage : m)),
          updatedAt: nowISO(),
        };

        set((s) => ({
          ...s,
          rooms: s.rooms.map((r) => (r.id === roomId ? updatedRoom : r)),
        }));

        runRemote(async (workspaceId) => {
          await persistMessage(workspaceId, updatedMessage);
        });
      },

      refreshTopics: refreshTopicsForRoom,

      upsertTopic: (topic) => {
        set((s) => ({
          ...s,
          topics: s.topics.some((t) => t.id === topic.id)
            ? s.topics.map((t) => (t.id === topic.id ? topic : t))
            : [topic, ...s.topics],
        }));
      },

      setTopicSummary: (topicId, summary) => {
        set((s) => ({
          ...s,
          topics: s.topics.map((t) => (t.id === topicId ? { ...t, summary } : t)),
        }));
      },

      removeTopicPermanently: (roomId, topicId) => {
        set((s) => ({
          ...s,
          topics: s.topics.filter((t) => t.id !== topicId),
          topicMembers: s.topicMembers.filter((m) => m.topicId !== topicId),
          tasks: s.tasks.filter((t) => t.topicId !== topicId),
          memory: s.memory.filter((m) => m.topicId !== topicId),
          approvals: s.approvals.filter((a) => a.topicId !== topicId),
          workLog: s.workLog.filter((w) => w.topicId !== topicId),
          rooms: s.rooms.map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  messages: room.messages.filter((message) => message.topicId !== topicId),
                  tasks: room.tasks.filter((taskId) =>
                    !s.tasks.some((task) => task.id === taskId && task.topicId === topicId),
                  ),
                  memory: room.memory.filter((memoryId) =>
                    !s.memory.some((entry) => entry.id === memoryId && entry.topicId === topicId),
                  ),
                }
              : room,
          ),
        }));
      },

      createTask: (task) => {
        const timestamp = nowISO();
        const created: Task = {
          id: task.id ?? uid("task"),
          roomId: task.roomId,
          topicId: task.topicId,
          title: task.title,
          description: task.description,
          status: task.status ?? "open",
          priority: task.priority ?? "medium",
          assigneeType: task.assigneeType ?? "ai",
          assigneeId: task.assigneeId ?? "",
          createdFrom: task.createdFrom,
          dueDate: task.dueDate,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        set((s) => ({
          ...s,
          tasks: [created, ...s.tasks],
          rooms: s.rooms.map((r) =>
            r.id === created.roomId ? { ...r, tasks: [...r.tasks, created.id] } : r,
          ),
        }));
        runRemote((workspaceId) => persistTask(workspaceId, created));
        return created;
      },

      updateTask: (id, patch) => {
        const current = stateRef.current.tasks.find((task) => task.id === id);
        if (!current) return;
        const updated = { ...current, ...patch, updatedAt: nowISO() };
        set((s) => ({
          ...s,
          tasks: s.tasks.map((t) => (t.id === id ? updated : t)),
        }));
        runRemote((workspaceId) => persistTask(workspaceId, updated));
      },

      createMemory: (m) => {
        const created: MemoryEntry = {
          id: m.id ?? uid("mem"),
          roomId: m.roomId,
          topicId: m.topicId,
          type: m.type ?? "general",
          title: m.title,
          content: m.content,
          status: m.status ?? "draft",
          createdByType: m.createdByType ?? "ai",
          createdById: m.createdById ?? "",
          createdAt: nowISO(),
        };
        set((s) => ({
          ...s,
          memory: [created, ...s.memory],
          rooms: s.rooms.map((r) =>
            r.id === created.roomId ? { ...r, memory: [...r.memory, created.id] } : r,
          ),
        }));
        runRemote((workspaceId) => persistMemory(workspaceId, created));
        return created;
      },

      updateMemory: (id, patch) => {
        const current = stateRef.current.memory.find((memory) => memory.id === id);
        if (!current) return;
        const updated = { ...current, ...patch };
        set((s) => ({
          ...s,
          memory: s.memory.map((m) => (m.id === id ? updated : m)),
        }));
        runRemote((workspaceId) => persistMemory(workspaceId, updated));
      },

      createApproval: (a) => {
        const created: Approval = {
          id: a.id ?? uid("appr"),
          roomId: a.roomId,
          requestedBy: a.requestedBy,
          title: a.title,
          description: a.description ?? "",
          risk: a.risk ?? "medium",
          status: a.status ?? "pending",
          actionType: a.actionType ?? "external_action",
          createdAt: nowISO(),
        };
        set((s) => ({ ...s, approvals: [created, ...s.approvals] }));
        runRemote((workspaceId) => persistApproval(workspaceId, created));
        return created;
      },

      resolveApproval: (id, approved) => {
        const current = stateRef.current;
        const approval = current.approvals.find((a) => a.id === id);
        if (!approval) return;
        const resolvedAt = nowISO();
        const updatedApproval: Approval = {
          ...approval,
          status: approved ? "approved" : "rejected",
          resolvedAt,
        };
        const createdWorkLog: WorkLogEvent = {
          id: uid("wl"),
          roomId: approval.roomId,
          employeeId: approval.requestedBy,
          action: approved ? "Approval granted" : "Approval rejected",
          summary: `${approved ? "Approved" : "Rejected"}: ${approval.title}`,
          status: approved ? "success" : "failed",
          relatedEntityType: "approval",
          relatedEntityId: approval.id,
          createdAt: resolvedAt,
        };

        let updatedMemory = current.memory;
        let updatedEmployees = current.employees.map((e) =>
          e.id === approval.requestedBy && e.status === "waiting_approval"
            ? { ...e, status: "idle" as const }
            : e,
        );

        if (approved && approval.actionType === "memory_pin") {
          updatedMemory = updatedMemory.map((m) =>
            m.roomId === approval.roomId && m.status !== "pinned"
              ? { ...m, status: "pinned" as const }
              : m,
          );
        }

        if (approved && approval.actionType === "tool_access") {
          updatedEmployees = updatedEmployees.map((e) =>
            e.id === approval.requestedBy
              ? {
                  ...e,
                  status: e.status === "waiting_approval" ? "working" : e.status,
                  tools: e.tools.map((tl) =>
                    approval.title.toLowerCase().includes(tl.name.toLowerCase())
                      ? { ...tl, status: "connected" as const, permission: "write" as const }
                      : tl,
                  ),
                }
              : e,
          );
        }

        set((s) => ({
          ...s,
          approvals: s.approvals.map((a) => (a.id === id ? updatedApproval : a)),
          workLog: [createdWorkLog, ...s.workLog],
          memory: updatedMemory,
          employees: updatedEmployees,
        }));

        runRemote(async (workspaceId) => {
          await persistApproval(workspaceId, updatedApproval);
          await persistWorkLog(workspaceId, createdWorkLog);
          await Promise.all(
            updatedMemory
              .filter((m) => current.memory.find((old) => old.id === m.id)?.status !== m.status)
              .map((m) => persistMemory(workspaceId, m)),
          );
          await Promise.all(
            updatedEmployees
              .filter((e) => current.employees.find((old) => old.id === e.id) !== e)
              .map((e) => persistEmployee(workspaceId, e)),
          );
        });
      },

      addWorkLog: (e) => {
        const created: WorkLogEvent = {
          id: e.id ?? uid("wl"),
          roomId: e.roomId,
          employeeId: e.employeeId,
          action: e.action,
          summary: e.summary ?? "",
          toolUsed: e.toolUsed,
          status: e.status ?? "success",
          relatedEntityType: e.relatedEntityType,
          relatedEntityId: e.relatedEntityId,
          createdAt: e.createdAt ?? nowISO(),
        };
        set((s) => ({ ...s, workLog: [created, ...s.workLog] }));
        runRemote((workspaceId) => persistWorkLog(workspaceId, created));
        return created;
      },

      startCall: (call) => {
        set((s) => ({ ...s, calls: [call, ...s.calls] }));
        runRemote((workspaceId) => persistCall(workspaceId, call));
        return call;
      },

      addTranscriptLine: (callId, line) => {
        const current = stateRef.current.calls.find((call) => call.id === callId);
        if (!current) return;
        const updated = { ...current, transcript: [...current.transcript, line] };
        set((s) => ({
          ...s,
          calls: s.calls.map((c) => (c.id === callId ? updated : c)),
        }));
        runRemote(async (workspaceId) => {
          await persistCallTranscriptLine(workspaceId, callId, line);
          await persistCall(workspaceId, updated);
        });
      },

      setSpeaking: (callId, speakerId) => {
        const current = stateRef.current.calls.find((call) => call.id === callId);
        if (!current) return;
        const updated = {
          ...current,
          participants: current.participants.map((p) => ({
            ...p,
            speaking: p.id === speakerId,
          })),
        };
        set((s) => ({
          ...s,
          calls: s.calls.map((c) => (c.id === callId ? updated : c)),
        }));
        runRemote((workspaceId) => persistCall(workspaceId, updated));
      },

      addActionItem: (callId, item) => {
        const current = stateRef.current.calls.find((call) => call.id === callId);
        if (!current || current.actionItems.includes(item)) return;
        const updated = { ...current, actionItems: [...current.actionItems, item] };
        set((s) => ({
          ...s,
          calls: s.calls.map((c) => (c.id === callId ? updated : c)),
        }));
        runRemote((workspaceId) => persistCall(workspaceId, updated));
      },

      endCall: (callId) => {
        const current = stateRef.current.calls.find((call) => call.id === callId);
        if (!current) return;
        const endedAt = nowISO();
        const updated = {
          ...current,
          status: "ended" as const,
          endedAt,
          participants: current.participants.map((p) => ({ ...p, speaking: false })),
        };

        set((s) => ({
          ...s,
          calls: s.calls.map((c) => (c.id === callId ? updated : c)),
          employees: s.employees.map((e) =>
            e.status === "on_call" ? { ...e, status: "idle" } : e,
          ),
        }));

        runRemote((workspaceId) => persistCall(workspaceId, updated));
      },

      updateSettings: (patch) =>
        set((s) => ({ ...s, settings: { ...s.settings, ...patch } })),

      inviteWorkspaceMember: async (email, role) => {
        const current = stateRef.current;
        if (backendRef.current !== "supabase") {
          throw new Error("Invitations are available in real workspaces only.");
        }
        if (!current.user) throw new Error("You need to be signed in to invite people.");
        const invitedEmail = email.trim().toLowerCase();
        if (!invitedEmail) throw new Error("Enter an email address.");

        const invitation = await createWorkspaceInvitationRemote(
          current.workspace.id,
          invitedEmail,
          role,
          current.user.id,
        );

        set((s) => ({
          ...s,
          workspaceInvitations: [
            { ...invitation, workspaceName: s.workspace.name, invitedByName: s.user?.name },
            ...s.workspaceInvitations.filter((i) => i.id !== invitation.id),
          ],
        }));
      },

      acceptWorkspaceInvitation: async (id) => {
        const current = stateRef.current;
        const user = authUserRef.current;
        if (!user) throw new Error("You need to be signed in to accept an invite.");
        const invitation = current.workspaceInvitations.find((invite) => invite.id === id);
        if (!invitation) throw new Error("Invitation not found.");

        const loaded = await acceptWorkspaceInvitationRemote(user, invitation);
        setRemoteState(loaded);
        setBackend("supabase");
        setError(null);
      },

      declineWorkspaceInvitation: async (id) => {
        await declineWorkspaceInvitationRemote(id);
        set((s) => ({
          ...s,
          workspaceInvitations: s.workspaceInvitations.map((invite) =>
            invite.id === id ? { ...invite, status: "declined" } : invite,
          ),
        }));
      },

      revokeWorkspaceInvitation: async (id) => {
        await revokeWorkspaceInvitationRemote(id);
        set((s) => ({
          ...s,
          workspaceInvitations: s.workspaceInvitations.map((invite) =>
            invite.id === id ? { ...invite, status: "revoked" } : invite,
          ),
        }));
      },

      setToolStatus: (toolId, status) => {
        set((s) => ({
          ...s,
          tools: s.tools.map((t) => (t.id === toolId ? { ...t, status } : t)),
        }));
        runRemote((workspaceId) => persistWorkspaceToolStatus(workspaceId, toolId, status));
      },

      resetDemoData: () => {
        if (!ENABLE_DEMO_MODE && backendRef.current !== "supabase") return;
        const current = stateRef.current;
        const fresh =
          backendRef.current === "supabase" && current.user
            ? buildFreshWorkspaceState(
                current.user,
                current.workspace,
                false,
                current.workspaceMembers,
                current.workspaceInvitations,
              )
            : buildDemoState();

        setState(fresh);
        runRemote((workspaceId) => resetWorkspaceToState({ ...fresh, workspace: { ...fresh.workspace, id: workspaceId } }));
      },

      clearWorkspaceData: () => {
        const current = stateRef.current;
        if (!current.user || backendRef.current !== "supabase") return;
        const fresh = buildFreshWorkspaceState(
          current.user,
          current.workspace,
          false,
          current.workspaceMembers,
          current.workspaceInvitations,
        );
        setState(fresh);
        runRemote((workspaceId) => resetWorkspaceToState({ ...fresh, workspace: { ...fresh.workspace, id: workspaceId } }));
      },

      switchWorkspace: async (workspaceId: string) => {
        const user = authUserRef.current;
        if (!user || backendRef.current !== "supabase") return;
        setActiveWorkspaceId(workspaceId);
        await loadRemote(user, workspaceId);
      },
    };
  }, [loadRemote, runRemote, setRemoteState]);

  const value = useMemo<StoreValue>(
    () => ({ state, hydrated, backend, error, userWorkspaces, actions }),
    [state, hydrated, backend, error, userWorkspaces, actions],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

// Convenience selectors -----------------------------------------------------

export function useEmployees() {
  return useStore().state.employees;
}

export function useEmployee(id: string | undefined) {
  const { state } = useStore();
  return useMemo(() => state.employees.find((e) => e.id === id), [state.employees, id]);
}

export function useRoom(id: string | undefined) {
  const { state } = useStore();
  return useMemo(() => state.rooms.find((r) => r.id === id), [state.rooms, id]);
}
