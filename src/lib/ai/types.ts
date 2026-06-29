export type {
  AIEmployee,
  Approval,
  EmployeePermissions,
  EmployeeResponse,
  EmployeeResponseEffect,
  EmployeeStatus,
  MemoryEntry,
  MessageArtifact,
  ProjectRoom,
  RoomMessage,
  SendMessageInput,
  Task,
  WorkLogEvent,
  Workspace,
} from "@/lib/types";

export type ModelProvider = "mock" | "siliconflow";

export type RespondRequestBody = {
  roomId: string;
  triggerMessageId?: string;
  content: string;
  mode?: "mock" | "live";
};

export type MessageSendResult = {
  humanMessage: import("@/lib/types").RoomMessage;
  aiResponses: import("@/lib/types").EmployeeResponse[];
  aiMessages: import("@/lib/types").RoomMessage[];
};
