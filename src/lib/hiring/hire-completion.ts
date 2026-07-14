import { welcomeMessage } from "@/lib/hiring/build-brief";
import type { BriefComposeSection } from "@/lib/hiring/detect-brief-change";
import { candidateToEmployee } from "@/lib/hiring/map-candidate";
import { isHiringSmallTalk } from "@/lib/hiring/maya-recruiter-state";
import { MAYA_EMPLOYEE_ID, MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import type { AiEmployeeApplicant, AiEmployeeJobBrief } from "@/lib/hiring/types";
import type { ProjectRoom, RoomTopic, WorkLogEvent } from "@/lib/types";
import { generalTopicForRoom } from "@/lib/topics";
import { nowISO, uid } from "@/lib/utils";

export type HireActions = {
  hireEmployee: (employee: ReturnType<typeof candidateToEmployee>) => void;
  openOrCreateDM: (employeeId: string) => ProjectRoom;
  addMessage: (
    roomId: string,
    msg: {
      senderType: "human" | "ai" | "system";
      senderId: string;
      senderName: string;
      content: string;
      topicId?: string;
    },
  ) => void;
  addWorkLog: (
    e: Partial<WorkLogEvent> & { action: string; roomId: string; employeeId: string },
  ) => WorkLogEvent;
};

export function completeHireFromCandidate(params: {
  actions: HireActions;
  userName?: string;
  candidate: AiEmployeeApplicant;
  brief: AiEmployeeJobBrief;
  departmentId: string | null;
  roleKey: string | null;
  mayaRoomId?: string;
  mayaTopicId?: string;
  allTopics?: RoomTopic[];
  defaultRoomId?: string;
  /** When onboarding persists via completeFirstHire, skip duplicate work-log */
  skipWorkLog?: boolean;
}): { employeeId: string; dmRoomId: string; topicId?: string } {
  const employee = candidateToEmployee(
    params.candidate,
    params.brief,
    params.departmentId,
    params.roleKey,
  );
  employee.id = uid("emp");
  if (params.defaultRoomId) {
    employee.defaultRoomId = params.defaultRoomId;
  }

  params.actions.hireEmployee(employee);

  const dm = params.actions.openOrCreateDM(employee.id);
  const firstName = params.userName?.split(" ")[0] ?? "there";
  const generalTopicId =
    (params.allTopics ? generalTopicForRoom(params.allTopics, dm.id)?.id : undefined) ??
    `topic-general-${dm.id}`;
  params.actions.addMessage(dm.id, {
    senderType: "ai",
    senderId: employee.id,
    senderName: employee.name,
    content: welcomeMessage(employee.name, params.candidate.title, firstName, params.brief),
    topicId: generalTopicId,
  });

  const logRoomId = params.mayaRoomId ?? dm.id;
  if (!params.skipWorkLog) {
    params.actions.addWorkLog({
      id: uid("wl"),
      roomId: logRoomId,
      employeeId: employee.id,
      action: "Employee hired",
      summary: `Hired ${employee.name} as ${params.candidate.title}.`,
      status: "success",
      createdAt: nowISO(),
    });
  }

  if (params.mayaRoomId) {
    params.actions.addMessage(params.mayaRoomId, {
      senderType: "ai",
      senderId: MAYA_EMPLOYEE_ID,
      senderName: MAYA_EMPLOYEE_NAME,
      content: `Done — I hired ${employee.name} as your ${params.candidate.title}. I've opened their DM so you can give them the first task.`,
      topicId: params.mayaTopicId,
    });
  }

  return { employeeId: employee.id, dmRoomId: dm.id, topicId: generalTopicId };
}

export function completeHiresFromCandidates(params: {
  actions: HireActions;
  userName?: string;
  candidates: AiEmployeeApplicant[];
  brief: AiEmployeeJobBrief;
  departmentId: string | null;
  roleKey: string | null;
  mayaRoomId?: string;
  mayaTopicId?: string;
  allTopics?: RoomTopic[];
  defaultRoomId?: string;
  skipWorkLog?: boolean;
}): { employeeIds: string[]; dmRoomId: string; topicId?: string } {
  const employeeIds: string[] = [];
  let primaryDmRoomId = "";
  let primaryTopicId: string | undefined;

  for (const candidate of params.candidates) {
    const result = completeHireFromCandidate({
      actions: params.actions,
      userName: params.userName,
      candidate,
      brief: params.brief,
      departmentId: params.departmentId,
      roleKey: params.roleKey,
      mayaRoomId: params.candidates.length === 1 ? params.mayaRoomId : undefined,
      mayaTopicId: params.candidates.length === 1 ? params.mayaTopicId : undefined,
      allTopics: params.allTopics,
      defaultRoomId: params.defaultRoomId,
      skipWorkLog: params.skipWorkLog,
    });
    employeeIds.push(result.employeeId);
    if (!primaryDmRoomId) {
      primaryDmRoomId = result.dmRoomId;
      primaryTopicId = result.topicId;
    }
  }

  if (params.mayaRoomId && params.candidates.length > 1) {
    const names = params.candidates.map((c) => c.name).join(", ");
    params.actions.addMessage(params.mayaRoomId, {
      senderType: "ai",
      senderId: MAYA_EMPLOYEE_ID,
      senderName: MAYA_EMPLOYEE_NAME,
      content: `Done — I hired ${names}. Each has their own DM so you can give them their first tasks.`,
      topicId: params.mayaTopicId,
    });
  }

  return { employeeIds, dmRoomId: primaryDmRoomId, topicId: primaryTopicId };
}

export function logCandidatesGenerated(
  actions: HireActions,
  roomId: string,
  roleTitle: string,
) {
  actions.addWorkLog({
    id: uid("wl"),
    roomId,
    employeeId: MAYA_EMPLOYEE_ID,
    action: "Candidate shortlist generated",
    summary: `Generated 3 candidates for ${roleTitle}.`,
    status: "success",
    createdAt: nowISO(),
  });
}

export function logBriefUpdated(
  actions: HireActions,
  roomId: string,
  roleTitle: string,
) {
  actions.addWorkLog({
    id: uid("wl"),
    roomId,
    employeeId: MAYA_EMPLOYEE_ID,
    action: "Job brief updated",
    summary: `Updated job brief for ${roleTitle}.`,
    status: "success",
    createdAt: nowISO(),
  });
}

export function maybeLogBriefUpdated(
  actions: HireActions,
  roomId: string,
  userMessage: string,
  section: BriefComposeSection | null,
  roleTitle: string | undefined,
  lastLogKey: { current: string | null },
) {
  if (!section || isHiringSmallTalk(userMessage)) return;
  const title = roleTitle?.trim() || "this role";
  const key = `${title}:${section}`;
  if (lastLogKey.current === key) return;
  lastLogKey.current = key;
  logBriefUpdated(actions, roomId, title);
}
