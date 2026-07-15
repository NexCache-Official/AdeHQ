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
import { ENABLE_DEMO_MODE, WORKFORCE_CALLS_ENABLED } from "@/lib/config/features";
import {
  clearActiveWorkspaceId,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from "@/lib/active-workspace";
import { clearOnboardingLaunchPending } from "@/lib/hiring/data";
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
import { isPasswordRecoveryPending, clearPasswordRecoveryPending } from "@/lib/auth/recovery";
import { isRepeatedSignup } from "@/lib/auth/guards";
import { resendSignupConfirmation } from "@/lib/auth/confirmation";
import { mergeRoomMessages } from "@/lib/message-delivery";
import { mayaWelcomeMessage, MAYA_EMPLOYEE_ID } from "@/lib/hiring/maya";
import { resolveUniqueRoomName } from "@/lib/room-naming";
import { isMayaEmployee, isSystemEmployee, mergeMayaIntoState, mayaEmployeeStatus, buildMayaDmRoom, buildMayaEmployee, ensureMayaDmTopicsInState, dedupeMayaDmRooms, mergeEmployeesById, resolveMayaDmRoomId } from "@/lib/maya-employee";
import { isGroupRoom } from "@/lib/rooms";
import { ensureDmGeneralTopicInState } from "@/lib/dm-general-topic";
import { nowISO, uid } from "./utils";
import { SUPABASE_WORKSPACE_TABLES } from "./supabase/config";
import { supabase } from "./supabase/client";
import {
  buildFreshWorkspaceState,
  acceptWorkspaceInvitation as acceptWorkspaceInvitationRemote,
  createWorkspaceInvitation as createWorkspaceInvitationRemote,
  bootstrapWorkspaceRemote,
  createWorkspaceRemote,
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
  deleteTaskRecord,
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
  ) => Promise<{ needsEmailConfirmation: boolean; repeatedSignup?: boolean }>;
  login: (email: string, password: string) => Promise<{ onboardingComplete: boolean }>;
  bootstrapWorkspace: (workspaceName?: string) => Promise<void>;
  createWorkspace: (workspaceName: string) => Promise<{ workspaceId: string; workspaceName: string }>;
  setupOnboardingWorkspace: (payload: {
    workspaceName: string;
    room: { name: string; accent: string; description?: string };
  }) => Promise<{ workspaceId: string; firstRoomId: string; roomName: string; mayaDmRoomId: string }>;
  completeFirstHire: (payload: {
    employee: AIEmployee;
    workLog: WorkLogEvent;
    defaultRoomId?: string;
  }) => Promise<{ dmRoomId: string }>;
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
  completeOnboarding: () => Promise<void>;
  updateProfile: (patch: { name?: string; email?: string; workspaceName?: string }) => void;

  // employees
  hireEmployee: (employee: AIEmployee) => AIEmployee;
  updateEmployee: (id: string, patch: Partial<AIEmployee>) => void;
  removeEmployee: (id: string) => void;

  // rooms
  createRoom: (room: Partial<ProjectRoom> & { name: string }) => ProjectRoom;
  openOrCreateDM: (employeeId: string) => ProjectRoom;
  updateRoom: (id: string, patch: Partial<ProjectRoom>) => void;
  removeRoomPermanently: (roomId: string) => void;
  addEmployeeToRoom: (roomId: string, employeeId: string) => void;
  removeEmployeeFromRoom: (roomId: string, employeeId: string) => void;
  markRoomRead: (roomId: string) => void;

  // messages
  addMessage: (roomId: string, msg: Omit<RoomMessage, "id" | "roomId" | "createdAt"> & { id?: string; createdAt?: string }) => RoomMessage;
  addLocalMessage: (roomId: string, msg: Omit<RoomMessage, "id" | "roomId" | "createdAt"> & { id?: string; createdAt?: string }) => RoomMessage;
  removeLocalMessage: (roomId: string, messageId: string) => void;
  updateMessage: (roomId: string, messageId: string, patch: Partial<RoomMessage>) => void;
  /** Local-only update — does not persist. For live streaming placeholders. */
  updateLocalMessage: (roomId: string, messageId: string, patch: Partial<RoomMessage>) => void;
  refreshTopics: (roomId: string) => Promise<void>;
  refreshWorkLogForTopic: (topicId: string) => Promise<void>;
  mergeWorkLogEvents: (events: import("@/lib/types").WorkLogEvent[]) => void;
  setTopicMemberRead: (topicId: string, memberId: string, lastReadMessageId: string) => void;
  upsertTopic: (topic: import("@/lib/types").RoomTopic) => void;
  setTopicSummary: (topicId: string, summary: string) => void;
  removeTopicPermanently: (roomId: string, topicId: string) => void;
  clearTopicMessages: (roomId: string, topicId: string) => void;

  // tasks
  createTask: (task: Partial<Task> & { title: string; roomId: string }) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  removeTask: (id: string) => void;

  // memory
  createMemory: (m: Partial<MemoryEntry> & { title: string; content: string; roomId: string }) => MemoryEntry;
  updateMemory: (id: string, patch: Partial<MemoryEntry>) => void;
  mergeMemoryEntry: (entry: MemoryEntry) => void;
  removeMemoryEntry: (memoryId: string) => void;

  // approvals
  createApproval: (a: Partial<Approval> & { title: string; roomId: string; requestedBy: string }) => Approval;
  resolveApproval: (id: string, approved: boolean) => void;
  /** Merge a server-resolved approval into local state (real workspaces). */
  mergeApproval: (approval: Approval) => void;
  /** Force a workspace reload (approvals, inbox-linked state) for live surfaces. */
  refreshWorkspace: () => Promise<void>;
  /** Fetch a single approval by id and merge into store (fixes Review race). */
  ensureApproval: (approvalId: string) => Promise<Approval | null>;

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
  /** Owner-only: permanently delete an incomplete onboarding workspace. */
  cancelIncompleteWorkspace: (workspaceId: string) => Promise<void>;
};

type StoreValue = {
  state: DemoState;
  hydrated: boolean;
  backend: BackendMode;
  error: string | null;
  userWorkspaces: UserWorkspaceSummary[];
  /** True while switching HQs — AppShell must not bounce to /onboarding on a transient false flag. */
  workspaceTransitioning: boolean;
  actions: StoreActions;
};

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState>(() => buildSignedOutState());
  const [hydrated, setHydrated] = useState(false);
  const [backend, setBackend] = useState<BackendMode>("demo");
  const [error, setError] = useState<string | null>(null);
  const [userWorkspaces, setUserWorkspaces] = useState<UserWorkspaceSummary[]>([]);
  const [workspaceTransitioning, setWorkspaceTransitioning] = useState(false);
  const stateRef = useRef(state);
  const backendRef = useRef<BackendMode>(backend);
  const authUserRef = useRef<User | null>(null);
  const authBusyRef = useRef(false);
  const userWorkspacesRef = useRef<UserWorkspaceSummary[]>([]);
  /** Workspaces sealed complete locally — realtime reloads must not regress the flag. */
  const onboardingSealedRef = useRef<Set<string>>(new Set());
  const setupOnboardingInFlightRef = useRef<Promise<{
    workspaceId: string;
    firstRoomId: string;
    roomName: string;
    mayaDmRoomId: string;
  }> | null>(null);
  const remoteQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** Monotonic load generation — discard stale loadRemote results after workspace switch. */
  const loadSeqRef = useRef(0);

  stateRef.current = state;
  backendRef.current = backend;
  userWorkspacesRef.current = userWorkspaces;

  const setRemoteState = useCallback((loaded: DemoState) => {
    setState((previous) => {
      const workspaceId = loaded.workspace.id;
      const sameWorkspace = previous.workspace.id === workspaceId && Boolean(workspaceId);

      // Cross-workspace: never merge. Shared ids (emp-maya, dm-emp-maya) would otherwise
      // leak employees and Maya chat history from HQ A into HQ B.
      const roomsWithMergedMessages = sameWorkspace
        ? loaded.rooms.map((loadedRoom) => {
            const previousRoom = previous.rooms.find((room) => room.id === loadedRoom.id);
            if (!previousRoom) return loadedRoom;
            return {
              ...loadedRoom,
              messages: mergeRoomMessages(previousRoom.messages, loadedRoom.messages),
            };
          })
        : loaded.rooms;

      const sealed =
        Boolean(workspaceId) && onboardingSealedRef.current.has(workspaceId);
      // Never let a stale realtime reload undo a just-completed onboarding seal.
      const onboardingComplete =
        sealed ||
        loaded.onboardingComplete ||
        (sameWorkspace && previous.onboardingComplete);

      if (onboardingComplete && workspaceId) {
        onboardingSealedRef.current.add(workspaceId);
      }

      const merged = mergeMayaIntoState(
        {
          ...loaded,
          onboardingComplete,
          workspace: {
            ...loaded.workspace,
            onboardingComplete:
              onboardingComplete || Boolean(loaded.workspace.onboardingComplete),
          },
          rooms: roomsWithMergedMessages,
          employees: sameWorkspace
            ? mergeEmployeesById(previous.employees, loaded.employees)
            : loaded.employees,
          // Settings are per-workspace; do not carry HQ A settings into HQ B.
          settings: sameWorkspace
            ? (previous.settings ?? loaded.settings)
            : loaded.settings,
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
    async (
      user: User,
      preferredWorkspaceId?: string,
    ): Promise<{ onboardingComplete: boolean; hasWorkspace: boolean }> => {
      if (!isEmailConfirmed(user)) {
        await supabase.auth.signOut();
        authUserRef.current = null;
        setBackend("demo");
        setState(buildSignedOutState());
        setHydrated(true);
        throw new Error("Email not confirmed");
      }

      authUserRef.current = user;
      const seq = ++loadSeqRef.current;
      const workspaceId = preferredWorkspaceId ?? getActiveWorkspaceId() ?? undefined;
      const loaded = await loadWorkspaceState(user, workspaceId);

      // Another switch/load started while we were fetching — drop this result.
      if (seq !== loadSeqRef.current) {
        return {
          onboardingComplete: stateRef.current.onboardingComplete,
          hasWorkspace: Boolean(stateRef.current.workspace.id),
        };
      }

      // Prefer the workspace we asked for; ignore mismatched stale payloads.
      if (
        preferredWorkspaceId &&
        loaded.workspace.id &&
        loaded.workspace.id !== preferredWorkspaceId
      ) {
        return {
          onboardingComplete: stateRef.current.onboardingComplete,
          hasWorkspace: Boolean(stateRef.current.workspace.id),
        };
      }

      if (loaded.workspace.id) setActiveWorkspaceId(loaded.workspace.id);
      const workspaces = await listUserWorkspaces(user.id);
      if (seq !== loadSeqRef.current) {
        return {
          onboardingComplete: stateRef.current.onboardingComplete,
          hasWorkspace: Boolean(stateRef.current.workspace.id),
        };
      }
      const sealedList = workspaces.map((ws) =>
        onboardingSealedRef.current.has(ws.id)
          ? { ...ws, onboardingComplete: true }
          : ws,
      );
      setUserWorkspaces(sealedList);
      userWorkspacesRef.current = sealedList;

      if (loaded.onboardingComplete && loaded.workspace.id) {
        onboardingSealedRef.current.add(loaded.workspace.id);
      }

      setRemoteState(loaded);
      setBackend("supabase");
      setHydrated(true);
      setError(null);

      // Return the freshly loaded flags directly — stateRef is only updated
      // inside the setState updater (next render), so reading it here is stale.
      return {
        onboardingComplete: loaded.onboardingComplete,
        hasWorkspace: Boolean(loaded.workspace.id),
      };
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
          if (isPasswordRecoveryPending()) {
            authUserRef.current = data.session.user;
            if (!active) return;
            setBackend("demo");
            setState(buildSignedOutState());
            setHydrated(true);
            return;
          }
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
        if (!isPasswordRecoveryPending()) {
          clearPasswordRecoveryPending();
        }
        authUserRef.current = null;
        setBackend("demo");
        setState(buildSignedOutState());
        setHydrated(true);
        return;
      }

      if (event === "PASSWORD_RECOVERY") {
        return;
      }

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (isPasswordRecoveryPending()) {
          return;
        }
        if (!isEmailConfirmed(session.user)) {
          void supabase.auth.signOut();
          return;
        }
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
        // Always reload the subscribed workspace — never the (possibly switched) active id alone.
        if (user) void loadRemote(user, workspaceId);
      }, 120);
    };

    let realtimeSubscription = supabase.channel(`workspace:${workspaceId}`);
    SUPABASE_WORKSPACE_TABLES.forEach((table) => {
      realtimeSubscription = realtimeSubscription.on(
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

    realtimeSubscription = realtimeSubscription
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

    void realtimeSubscription.subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(realtimeSubscription);
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

    const refreshWorkLogForTopic = async (topicId: string) => {
      if (backendRef.current !== "supabase") return;
      try {
        const { refreshTopicWorkLog } = await import("@/lib/orchestration/orchestration-client");
        const events = await refreshTopicWorkLog(topicId);
        if (!events?.length) return;
        set((current) => {
          const byId = new Map(current.workLog.map((entry) => [entry.id, entry]));
          for (const event of events) {
            byId.set(event.id, event);
          }
          return {
            ...current,
            workLog: Array.from(byId.values()).sort(
              (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
            ),
          };
        });
      } catch {
        // non-blocking
      }
    };

    const mergeWorkLogEvents = (events: WorkLogEvent[]) => {
      if (!events.length) return;
      set((current) => {
        const byId = new Map(current.workLog.map((entry) => [entry.id, entry]));
        for (const event of events) {
          byId.set(event.id, event);
        }
        return {
          ...current,
          workLog: Array.from(byId.values()).sort(
            (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
          ),
        };
      });
    };

    const setTopicMemberRead = (
      topicId: string,
      memberId: string,
      lastReadMessageId: string,
    ) => {
      const timestamp = nowISO();
      set((current) => ({
        ...current,
        topicMembers: current.topicMembers.map((member) =>
          member.topicId === topicId &&
          member.memberId === memberId &&
          member.memberType === "human"
            ? { ...member, lastReadMessageId, lastReadAt: timestamp }
            : member,
        ),
      }));
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

          const repeatedSignup = isRepeatedSignup(data.user);
          const needsConfirm = !data.session || !isEmailConfirmed(data.user) || repeatedSignup;

          if (needsConfirm) {
            if (data.session) await supabase.auth.signOut();
            if (repeatedSignup) {
              try {
                await resendSignupConfirmation(user.email);
              } catch {
                // Resend may rate-limit; signup UI still offers manual resend.
              }
            }
            return { needsEmailConfirmation: true, repeatedSignup };
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
          const loaded = await loadRemote(data.user);
          return { onboardingComplete: loaded.onboardingComplete };
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

      createWorkspace: async (workspaceName) => {
        authBusyRef.current = true;
        try {
          const user = authUserRef.current;
          if (!user) throw new Error("Sign in to continue.");
          if (!isEmailConfirmed(user)) {
            throw new Error("Confirm your email before creating a workspace.");
          }
          const name = workspaceName.trim();
          if (!name) throw new Error("Workspace name is required.");

          if (backendRef.current !== "supabase") {
            const workspaceId = uid("ws");
            set((s) => ({
              ...s,
              workspace: {
                ...s.workspace,
                id: workspaceId,
                name,
                onboardingComplete: false,
              },
              onboardingComplete: false,
              rooms: [],
              employees: [],
            }));
            setUserWorkspaces((prev) => [
              ...prev,
              {
                id: workspaceId,
                name,
                role: "admin",
                workspaceMode: "demo",
                onboardingComplete: false,
              },
            ]);
            return { workspaceId, workspaceName: name };
          }

          const created = await createWorkspaceRemote(name);
          setActiveWorkspaceId(created.workspaceId);
          await loadRemote(user, created.workspaceId);
          return created;
        } finally {
          authBusyRef.current = false;
        }
      },

      setupOnboardingWorkspace: async ({ workspaceName, room: roomInput }) => {
        if (setupOnboardingInFlightRef.current) {
          return setupOnboardingInFlightRef.current;
        }

        const run = (async () => {
          authBusyRef.current = true;
          try {
            const user = authUserRef.current;
            if (!user) throw new Error("Sign in to continue.");
            if (!isEmailConfirmed(user)) {
              throw new Error("Confirm your email before creating a workspace.");
            }

            const name =
              workspaceName.trim() ||
              stateRef.current.workspace.name ||
              (typeof user.user_metadata?.workspace_name === "string"
                ? user.user_metadata.workspace_name
                : "My AI Workspace");

            // Idempotent: never recreate workspace/first room if setup already ran.
            const existingProjectRoom = stateRef.current.rooms.find((r) => r.kind === "room");
            if (stateRef.current.workspace.id && existingProjectRoom) {
              return {
                workspaceId: stateRef.current.workspace.id,
                firstRoomId: existingProjectRoom.id,
                roomName: existingProjectRoom.name,
                mayaDmRoomId: resolveMayaDmRoomId(stateRef.current.rooms),
              };
            }

            if (backendRef.current !== "supabase") {
              const workspaceId = stateRef.current.workspace.id || uid("ws");
              const timestamp = nowISO();
              const roomId = uid("room");
              // Demo mode: first room keeps the requested name (no suffix race).
              const roomName = roomInput.name.trim() || "Launch Room";
              const room: ProjectRoom = {
                id: roomId,
                name: roomName,
                kind: "room",
                description: roomInput.description ?? `${roomName} workstream`,
                brief: "",
                humans: [user.id],
                aiEmployees: [],
                accent: roomInput.accent,
                messages: [
                  {
                    id: uid("msg"),
                    roomId,
                    senderType: "system",
                    senderId: "system",
                    senderName: "AdeHQ",
                    content: `Your ${roomName} workstream is ready.`,
                    createdAt: timestamp,
                  },
                ],
                tasks: [],
                memory: [],
                unread: 0,
                createdAt: timestamp,
                updatedAt: timestamp,
              };
              const welcome = mayaWelcomeMessage(
                typeof user.user_metadata?.name === "string"
                  ? user.user_metadata.name.split(" ")[0] ?? "there"
                  : "there",
              );
              set((s) => {
                const merged = mergeMayaIntoState(
                  { ...s, workspace: { ...s.workspace, id: workspaceId, name } },
                  user.id,
                  welcome,
                );
                return {
                  ...merged,
                  rooms: [room, ...merged.rooms.filter((r) => r.id !== room.id)],
                };
              });
              return {
                workspaceId,
                firstRoomId: roomId,
                roomName,
                mayaDmRoomId: resolveMayaDmRoomId(stateRef.current.rooms),
              };
            }

            // Prefer the active workspace (e.g. just created via POST /api/workspaces).
            // Only bootstrap when the user has no workspace yet — bootstrap is idempotent
            // and would otherwise trap additional HQs onto the first membership.
            let workspaceId = stateRef.current.workspace.id;
            if (workspaceId) {
              if (name && name !== stateRef.current.workspace.name) {
                await persistWorkspace(workspaceId, { name });
              }
              await loadRemote(user, workspaceId);
            } else {
              const bootstrapped = await bootstrapWorkspaceRemote(name);
              workspaceId = bootstrapped.workspaceId;
              await loadRemote(user, workspaceId);
            }

            const { authHeaders } = await import("@/lib/api/auth-client");
            const headers = await authHeaders();
            const profileFirstName = stateRef.current.user?.name?.split(/\s+/)[0];
            const mayaRes = await fetch("/api/workspaces/ensure-maya", {
              method: "POST",
              headers,
              body: JSON.stringify({
                workspaceId,
                ...(profileFirstName ? { firstName: profileFirstName } : {}),
              }),
            });
            const mayaPayload = await mayaRes.json().catch(() => ({}));
            if (!mayaRes.ok) {
              throw new Error(
                typeof mayaPayload.error === "string"
                  ? mayaPayload.error
                  : "Could not set up Maya.",
              );
            }
            await loadRemote(user, workspaceId);

            const alreadyProvisioned = stateRef.current.rooms.find((r) => r.kind === "room");
            if (alreadyProvisioned) {
              return {
                workspaceId,
                firstRoomId: alreadyProvisioned.id,
                roomName: alreadyProvisioned.name,
                mayaDmRoomId: resolveMayaDmRoomId(stateRef.current.rooms),
              };
            }

            // Server-side idempotent first room — never suffix for onboarding.
            const roomRes = await fetch("/api/workspaces/ensure-first-room", {
              method: "POST",
              headers,
              body: JSON.stringify({
                workspaceId,
                name: roomInput.name.trim() || "Launch Room",
                accent: roomInput.accent,
                description: roomInput.description,
              }),
            });
            const roomPayload = await roomRes.json().catch(() => ({}));
            if (!roomRes.ok) {
              throw new Error(
                typeof roomPayload.error === "string"
                  ? roomPayload.error
                  : "Could not create your first room.",
              );
            }
            await loadRemote(user, workspaceId);

            return {
              workspaceId,
              firstRoomId: String(roomPayload.roomId),
              roomName: String(roomPayload.roomName),
              mayaDmRoomId: resolveMayaDmRoomId(stateRef.current.rooms),
            };
          } finally {
            authBusyRef.current = false;
          }
        })();

        setupOnboardingInFlightRef.current = run;
        try {
          return await run;
        } finally {
          if (setupOnboardingInFlightRef.current === run) {
            setupOnboardingInFlightRef.current = null;
          }
        }
      },

      completeFirstHire: async ({ employee, workLog, defaultRoomId }) => {
        authBusyRef.current = true;
        try {
          const user = authUserRef.current;
          if (!user) throw new Error("Sign in to complete hire.");

          const workspaceId = stateRef.current.workspace.id;
          if (!workspaceId) {
            throw new Error("Workspace not ready. Complete onboarding setup before hiring.");
          }

          if (workspaceId) onboardingSealedRef.current.add(workspaceId);

          if (backendRef.current !== "supabase") {
            set((s) => ({
              ...s,
              onboardingComplete: true,
              workspace: { ...s.workspace, onboardingComplete: true },
              employees: s.employees.some((e) => e.id === employee.id)
                ? s.employees
                : [...s.employees, employee],
              workLog: [workLog, ...s.workLog],
            }));
            const dm = stateRef.current.rooms.find(
              (r) => r.kind === "dm" && r.dmEmployeeId === employee.id,
            );
            return { dmRoomId: dm?.id ?? `dm-${employee.id}` };
          }

          const alreadyHired = stateRef.current.employees.some((e) => e.id === employee.id);
          if (!alreadyHired) {
            await persistEmployee(workspaceId, employee);
          }
          if (defaultRoomId) {
            await persistRoomMember(workspaceId, defaultRoomId, "ai", employee.id);
          }
          await persistWorkLog(workspaceId, workLog);
          await persistWorkspace(workspaceId, { onboardingComplete: true });
          await loadRemote(user, workspaceId);
          return { dmRoomId: `dm-${employee.id}` };
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
              workspace: { ...s.workspace, onboardingComplete: true },
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

          let workspaceId = stateRef.current.workspace.id;
          if (workspaceId) {
            if (name && name !== stateRef.current.workspace.name) {
              await persistWorkspace(workspaceId, { name });
            }
          } else {
            const bootstrapped = await bootstrapWorkspaceRemote(name);
            workspaceId = bootstrapped.workspaceId;
          }

          onboardingSealedRef.current.add(workspaceId);

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
          clearPasswordRecoveryPending();
          authUserRef.current = null;
          setBackend("demo");
          setUserWorkspaces([]);
          onboardingSealedRef.current.clear();
          clearActiveWorkspaceId();
          setState(buildSignedOutState());
          setHydrated(true);
          setError(null);
        } finally {
          authBusyRef.current = false;
        }
      },

      clearError: () => setError(null),

      completeOnboarding: async () => {
        const workspaceId = stateRef.current.workspace.id;
        if (stateRef.current.onboardingComplete && workspaceId) {
          onboardingSealedRef.current.add(workspaceId);
          return;
        }

        if (workspaceId) onboardingSealedRef.current.add(workspaceId);

        set((s) => ({
          ...s,
          onboardingComplete: true,
          workspace: { ...s.workspace, onboardingComplete: true },
        }));
        if (workspaceId) {
          setUserWorkspaces((prev) =>
            prev.map((ws) =>
              ws.id === workspaceId ? { ...ws, onboardingComplete: true } : ws,
            ),
          );
        }

        if (backendRef.current !== "supabase") return;
        if (!workspaceId) return;

        await persistWorkspace(workspaceId, { onboardingComplete: true });

        // Confirm the write stuck; if RLS blocked the update, fail loudly.
        const { data, error } = await supabase
          .from("workspaces")
          .select("onboarding_complete")
          .eq("id", workspaceId)
          .maybeSingle();
        if (error) throw error;
        if (!data?.onboarding_complete) {
          onboardingSealedRef.current.delete(workspaceId);
          set((s) => ({
            ...s,
            onboardingComplete: false,
            workspace: { ...s.workspace, onboardingComplete: false },
          }));
          setUserWorkspaces((prev) =>
            prev.map((ws) =>
              ws.id === workspaceId ? { ...ws, onboardingComplete: false } : ws,
            ),
          );
          throw new Error("Could not mark onboarding complete. Try again.");
        }
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
        // Capture HQ at hire time — do not use whatever workspace is active when the queue runs.
        const hireWorkspaceId = current.workspace.id;
        if (!hireWorkspaceId) {
          throw new Error("Cannot hire without an active workspace.");
        }

        const defaultRoom = employee.defaultRoomId
          ? current.rooms.find((room) => room.id === employee.defaultRoomId)
          : undefined;
        const validDefaultRoomId =
          defaultRoom && isGroupRoom(defaultRoom) ? defaultRoom.id : undefined;
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

        set((s) => {
          // If the user already switched HQs, do not inject this employee into the wrong roster.
          if (s.workspace.id !== hireWorkspaceId) return s;
          return {
            ...s,
            employees: [...s.employees, safeEmployee],
            rooms: updatedRooms,
          };
        });

        if (backendRef.current === "supabase") {
          remoteQueueRef.current = remoteQueueRef.current
            .catch(() => undefined)
            .then(async () => {
              if (assignedRoom) await persistRoom(hireWorkspaceId, assignedRoom);
              await persistEmployee(hireWorkspaceId, safeEmployee);
              if (validDefaultRoomId) {
                await persistRoomMember(hireWorkspaceId, validDefaultRoomId, "ai", safeEmployee.id);
              }
            })
            .catch((err) => {
              console.error("[AdeHQ hireEmployee persist]", err);
              setError(errorMessage(err));
            });
        }

        return safeEmployee;
      },

      updateEmployee: (id, patch) => {
        const current = stateRef.current.employees.find((e) => e.id === id);
        if (!current) return;

        // Maya is product-immutable: ignore brief/permissions/tools/identity edits.
        // Only runtime counters (and forced online status) may refresh locally.
        let safePatch: Partial<AIEmployee>;
        if (isMayaEmployee(current)) {
          safePatch = { status: mayaEmployeeStatus() };
          if (typeof patch.messagesSent === "number") safePatch.messagesSent = patch.messagesSent;
          if (typeof patch.memoryCount === "number") safePatch.memoryCount = patch.memoryCount;
          if (typeof patch.approvalsRequested === "number") {
            safePatch.approvalsRequested = patch.approvalsRequested;
          }
          if (typeof patch.lastActiveAt === "string") safePatch.lastActiveAt = patch.lastActiveAt;
          const onlyStatus =
            Object.keys(safePatch).length === 1 && safePatch.status !== undefined;
          if (onlyStatus && current.status === mayaEmployeeStatus()) {
            return;
          }
        } else {
          safePatch = patch;
        }

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
        const uniqueName = resolveUniqueRoomName(stateRef.current.rooms, room.name);
        const created: ProjectRoom = {
          id,
          name: uniqueName,
          kind: "room",
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
          accent: room.accent ?? "#2f6fed",
          status: room.status ?? "active",
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
        if (existing) {
          set((st) => ensureDmGeneralTopicInState(st, existing.id, userId, employeeId).state);
          void refreshTopicsForRoom(existing.id);
          return existing;
        }
        const id = uid("dm");
        const timestamp = nowISO();
        const welcomeContent = `This is the start of your direct message with ${employee?.name ?? "your employee"}.`;
        const topicId = `topic-general-${id}`;
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
              topicId,
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

        set((st) => {
          const withRoom = { ...st, rooms: [created, ...st.rooms] };
          return ensureDmGeneralTopicInState(withRoom, created.id, userId, employeeId).state;
        });

        runRemote(async (workspaceId) => {
          await persistRoom(workspaceId, created);
          await Promise.all([
            ...created.humans.map((memberId) =>
              persistRoomMember(workspaceId, created.id, "human", memberId),
            ),
            ...created.aiEmployees.map((memberId) =>
              persistRoomMember(workspaceId, created.id, "ai", memberId),
            ),
          ]);
          await persistMessage(workspaceId, created.messages[0]);
          await refreshTopicsForRoom(created.id);
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

      removeRoomPermanently: (roomId) => {
        set((s) => {
          const topicIds = new Set(s.topics.filter((t) => t.roomId === roomId).map((t) => t.id));
          return {
            ...s,
            rooms: s.rooms.filter((r) => r.id !== roomId),
            topics: s.topics.filter((t) => t.roomId !== roomId),
            topicMembers: s.topicMembers.filter((m) => m.roomId !== roomId),
            tasks: s.tasks.filter((t) => t.roomId !== roomId),
            memory: s.memory.filter((m) => m.roomId !== roomId),
            approvals: s.approvals.filter((a) => a.roomId !== roomId),
            workLog: s.workLog.filter((w) => w.roomId !== roomId),
            employees: s.employees.map((e) =>
              e.defaultRoomId === roomId ? { ...e, defaultRoomId: undefined } : e,
            ),
          };
        });
      },

      addEmployeeToRoom: (roomId, employeeId) => {
        const employee = stateRef.current.employees.find((e) => e.id === employeeId);
        if (employee?.metadata?.canBeAssignedToRooms === false) return;
        const current = stateRef.current.rooms.find((room) => room.id === roomId);
        if (!current || !isGroupRoom(current) || current.aiEmployees.includes(employeeId)) return;
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
        const messageId = msg.id ?? uid("msg");
        const currentRoom = stateRef.current.rooms.find((room) => room.id === roomId);
        const clientId =
          msg.clientMessageId ?? (msg.senderType === "human" ? messageId : undefined);
        const existing =
          currentRoom?.messages.find((m) => m.id === messageId) ??
          (clientId
            ? currentRoom?.messages.find((m) => m.clientMessageId === clientId)
            : undefined) ??
          // Defensive: the same agent run should only ever produce one visible
          // reply. If it's somehow persisted or delivered twice under different
          // message ids (e.g. a realtime insert racing the request's own
          // response), treat the one already on screen as canonical instead of
          // rendering a second bubble.
          (msg.senderType === "ai" && msg.agentRunId
            ? currentRoom?.messages.find(
                (m) => m.senderType === "ai" && m.agentRunId === msg.agentRunId,
              )
            : undefined);
        if (existing) return existing;

        const created: RoomMessage = {
          id: messageId,
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
          clientMessageId: msg.clientMessageId ?? (msg.senderType === "human" ? messageId : undefined),
          createdAt: msg.createdAt ?? nowISO(),
        };
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
        const messageId = msg.id ?? uid("msg");
        const clientId =
          msg.clientMessageId ?? (msg.senderType === "human" ? messageId : undefined);
        let created: RoomMessage | null = null;

        // Must derive from the updater's `s` — stateRef can be stale across rapid calls
        // (topic migrate hydrates many messages back-to-back).
        set((s) => {
          const currentRoom = s.rooms.find((room) => room.id === roomId);
          const existing =
            currentRoom?.messages.find((m) => m.id === messageId) ??
            (clientId
              ? currentRoom?.messages.find((m) => m.clientMessageId === clientId)
              : undefined);
          if (existing) {
            created = existing;
            return s;
          }

          created = {
            id: messageId,
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
            deliveryStatus: msg.deliveryStatus,
            deliveredAt: msg.deliveredAt,
            clientMessageId:
              msg.clientMessageId ?? (msg.senderType === "human" ? messageId : undefined),
            createdAt: msg.createdAt ?? nowISO(),
          };

          if (!currentRoom) return s;
          return {
            ...s,
            rooms: s.rooms.map((r) =>
              r.id === roomId
                ? {
                    ...r,
                    messages: [...r.messages, created!],
                    updatedAt: nowISO(),
                  }
                : r,
            ),
          };
        });

        return (
          created ?? {
            id: messageId,
            roomId,
            topicId: msg.topicId,
            senderType: msg.senderType,
            senderId: msg.senderId,
            senderName: msg.senderName,
            content: msg.content,
            mentions: msg.mentions ?? [],
            createdAt: msg.createdAt ?? nowISO(),
          }
        );
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

      updateLocalMessage: (roomId, messageId, patch) => {
        set((s) => ({
          ...s,
          rooms: s.rooms.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  messages: r.messages.map((m) =>
                    m.id === messageId ? { ...m, ...patch } : m,
                  ),
                }
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
      refreshWorkLogForTopic,
      mergeWorkLogEvents,
      setTopicMemberRead,

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

      clearTopicMessages: (roomId, topicId) => {
        set((s) => ({
          ...s,
          topics: s.topics.map((t) =>
            t.id === topicId
              ? {
                  ...t,
                  summary: undefined,
                  pinnedSummary: null,
                  messageCount: 0,
                  lastMessageAt: null,
                  updatedAt: nowISO(),
                }
              : t,
          ),
          rooms: s.rooms.map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  messages: room.messages.filter((message) => message.topicId !== topicId),
                  updatedAt: nowISO(),
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

      removeTask: (id) => {
        const task = stateRef.current.tasks.find((t) => t.id === id);
        if (!task) return;
        set((s) => ({
          ...s,
          tasks: s.tasks.filter((t) => t.id !== id),
          rooms: s.rooms.map((r) =>
            r.id === task.roomId ? { ...r, tasks: r.tasks.filter((taskId) => taskId !== id) } : r,
          ),
        }));
        runRemote((workspaceId) => deleteTaskRecord(workspaceId, id));
      },

      createMemory: (m) => {
        const dedupeKey = m.dedupeKey;
        if (dedupeKey) {
          const existing = stateRef.current.memory.find((mem) => mem.dedupeKey === dedupeKey);
          if (existing) return existing;
        }

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
          category: m.category,
          scope: m.scope,
          tags: m.tags,
          sourceType: m.sourceType,
          sourceMessageId: m.sourceMessageId,
          suggestedById: m.suggestedById,
          suggestedByType: m.suggestedByType,
          savedByUserId: m.savedByUserId,
          metadata: m.metadata,
          dedupeKey: m.dedupeKey,
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

      mergeMemoryEntry: (entry) => {
        set((s) => {
          const exists = s.memory.some((m) => m.id === entry.id);
          const memory = exists
            ? s.memory.map((m) => (m.id === entry.id ? entry : m))
            : [entry, ...s.memory];
          const rooms = s.rooms.map((room) =>
            room.id === entry.roomId && !room.memory.includes(entry.id)
              ? { ...room, memory: [...room.memory, entry.id] }
              : room,
          );
          return { ...s, memory, rooms };
        });
        runRemote((workspaceId) => persistMemory(workspaceId, entry));
      },

      removeMemoryEntry: (memoryId) => {
        set((s) => ({
          ...s,
          memory: s.memory.filter((m) => m.id !== memoryId),
          rooms: s.rooms.map((room) => ({
            ...room,
            memory: room.memory.filter((id) => id !== memoryId),
          })),
        }));
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

      refreshWorkspace: async () => {
        const user = authUserRef.current;
        const workspaceId = stateRef.current.workspace.id;
        if (!user || !workspaceId || backendRef.current !== "supabase") return;
        await loadRemote(user, workspaceId);
      },

      ensureApproval: async (approvalId) => {
        const id = approvalId.trim();
        if (!id) return null;
        const existing = stateRef.current.approvals.find((a) => a.id === id);
        if (existing && existing.status !== "pending") return existing;
        try {
          const { authHeaders } = await import("@/lib/api/auth-client");
          const { parseJsonResponse } = await import("@/lib/api/parse-json-response");
          const response = await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
            headers: await authHeaders(),
            cache: "no-store",
          });
          const data = await parseJsonResponse<{
            approval?: Approval;
            draft?: {
              subject: string;
              recipientEmail: string;
              body: string;
              status: string;
            } | null;
            error?: string;
          }>(response);
          if (!response.ok || !data.approval) return existing ?? null;
          let approval = data.approval;
          if (
            approval.status === "pending" &&
            data.draft &&
            ["sent", "approved", "discarded", "cancelled"].includes(data.draft.status)
          ) {
            approval = {
              ...approval,
              status:
                data.draft.status === "discarded" || data.draft.status === "cancelled"
                  ? "rejected"
                  : "approved",
              resolutionNote:
                approval.resolutionNote ??
                (data.draft.status === "discarded" || data.draft.status === "cancelled"
                  ? "Draft no longer available"
                  : "Already handled in Inbox"),
            };
          }
          if (data.draft?.body && approval.actionPayload) {
            const args = {
              ...((approval.actionPayload.args as Record<string, unknown>) ?? {}),
              subject: data.draft.subject || undefined,
              recipientEmail: data.draft.recipientEmail || undefined,
              body: data.draft.body,
              bodyPreview: data.draft.body,
            };
            const fields = [
              data.draft.recipientEmail
                ? { label: "To", value: data.draft.recipientEmail }
                : null,
              data.draft.subject ? { label: "Subject", value: data.draft.subject } : null,
              data.draft.body ? { label: "Body", value: data.draft.body } : null,
            ].filter(Boolean) as Array<{ label: string; value: string }>;
            approval = {
              ...approval,
              actionPayload: { ...approval.actionPayload, args },
              previewSnapshot: {
                title: approval.previewSnapshot?.title ?? approval.title,
                summary: approval.previewSnapshot?.summary ?? approval.description,
                risk: approval.previewSnapshot?.risk ?? approval.risk,
                toolName: approval.previewSnapshot?.toolName,
                fields:
                  fields.length > 0 ? fields : (approval.previewSnapshot?.fields ?? []),
              },
            };
          }
          set((s) => {
            const exists = s.approvals.some((a) => a.id === approval.id);
            const approvals = exists
              ? s.approvals.map((a) => (a.id === approval.id ? { ...a, ...approval } : a))
              : [approval, ...s.approvals];
            return { ...s, approvals };
          });
          return approval;
        } catch {
          return existing ?? null;
        }
      },

      mergeApproval: (approval) => {
        set((s) => {
          const exists = s.approvals.some((a) => a.id === approval.id);
          const approvals = exists
            ? s.approvals.map((a) => (a.id === approval.id ? { ...a, ...approval } : a))
            : [approval, ...s.approvals];
          const employees = s.employees.map((e) =>
            e.id === approval.requestedBy &&
            approval.status !== "pending" &&
            e.status === "waiting_approval"
              ? { ...e, status: "idle" as const }
              : e,
          );
          return { ...s, approvals, employees };
        });
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
          topicId: e.topicId,
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
        if (!WORKFORCE_CALLS_ENABLED) return call;
        set((s) => ({ ...s, calls: [call, ...s.calls] }));
        runRemote((workspaceId) => persistCall(workspaceId, call));
        return call;
      },

      addTranscriptLine: (callId, line) => {
        if (!WORKFORCE_CALLS_ENABLED) return;
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
        if (!WORKFORCE_CALLS_ENABLED) return;
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
        if (!WORKFORCE_CALLS_ENABLED) return;
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
        if (!WORKFORCE_CALLS_ENABLED) return;
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
        if (loaded.workspace.id) setActiveWorkspaceId(loaded.workspace.id);
        const workspaces = await listUserWorkspaces(user.id);
        setUserWorkspaces(workspaces);
        setRemoteState(loaded);
        setBackend("supabase");
        setError(null);
      },

      declineWorkspaceInvitation: async (id) => {
        if (!id) return;
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
        if (workspaceId === stateRef.current.workspace.id) return;

        const summary = userWorkspacesRef.current.find((ws) => ws.id === workspaceId);
        const knownComplete =
          onboardingSealedRef.current.has(workspaceId) ||
          Boolean(summary?.onboardingComplete);

        // Leaving an unfinished Launch screen must not trap the next HQ on /onboarding.
        clearOnboardingLaunchPending();

        // Invalidate in-flight loads and clear cross-HQ ghosts immediately.
        loadSeqRef.current += 1;
        setActiveWorkspaceId(workspaceId);
        setWorkspaceTransitioning(true);
        setState((current) => {
          if (!current.user) return current;
          // Wipe roster/rooms immediately so HQ A never paints on HQ B during load.
          // Preserve known onboardingComplete so AppShell does not bounce to /onboarding.
          const cleared = buildFreshWorkspaceState(
            current.user,
            {
              id: workspaceId,
              name: summary?.name ?? "…",
              plan: "Free",
              workspaceMode: summary?.workspaceMode ?? "real",
              onboardingComplete: knownComplete,
            },
            knownComplete,
            [],
            [],
          );
          stateRef.current = cleared;
          return cleared;
        });
        try {
          await loadRemote(user, workspaceId);
        } finally {
          setWorkspaceTransitioning(false);
        }
      },

      cancelIncompleteWorkspace: async (workspaceId: string) => {
        const user = authUserRef.current;
        if (!user || backendRef.current !== "supabase") {
          throw new Error("Not signed in.");
        }

        const { authHeaders } = await import("@/lib/api/auth-client");
        const headers = await authHeaders(workspaceId);
        const response = await fetch(`/api/workspaces/${workspaceId}/cancel-onboarding`, {
          method: "POST",
          headers,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          remainingWorkspaceIds?: string[];
          nextWorkspaceId?: string | null;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Could not cancel onboarding.");
        }

        onboardingSealedRef.current.delete(workspaceId);
        const remaining = payload.remainingWorkspaceIds ?? [];
        setUserWorkspaces((prev) => prev.filter((ws) => ws.id !== workspaceId));

        const nextId =
          payload.nextWorkspaceId ??
          remaining.find((id) => id !== workspaceId) ??
          null;

        if (nextId) {
          setActiveWorkspaceId(nextId);
          await loadRemote(user, nextId);
        } else {
          clearActiveWorkspaceId();
          loadSeqRef.current += 1;
          const currentUser = stateRef.current.user;
          const empty = buildSignedOutState();
          if (currentUser) empty.user = currentUser;
          setState(empty);
          stateRef.current = empty;
          setUserWorkspaces([]);
        }
      },
    };
  }, [loadRemote, runRemote, setRemoteState]);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      hydrated,
      backend,
      error,
      userWorkspaces,
      workspaceTransitioning,
      actions,
    }),
    [state, hydrated, backend, error, userWorkspaces, workspaceTransitioning, actions],
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
