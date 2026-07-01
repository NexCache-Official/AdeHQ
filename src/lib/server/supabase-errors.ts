type PostgrestErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

export function postgrestErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as PostgrestErrorLike).message ?? "Unknown error");
  }
  return "Unknown error";
}

export function postgrestErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as PostgrestErrorLike).code;
    return code ? String(code) : undefined;
  }
  return undefined;
}

export function mapTopicCreateError(error: unknown): { status: number; message: string } {
  const message = postgrestErrorMessage(error);
  const code = postgrestErrorCode(error);

  if (code === "23505" || message.includes("channel_topics_room_title_unique")) {
    return {
      status: 409,
      message: "A topic with this title already exists in the channel.",
    };
  }

  if (code === "23503") {
    return {
      status: 404,
      message: "This channel was not found in your workspace. Refresh and try again.",
    };
  }

  if (code === "42P01" || code === "42703" || message.includes("does not exist")) {
    return {
      status: 503,
      message: "Workspace database is missing topic tables. Apply the latest Supabase migrations.",
    };
  }

  if (code === "42501" || message.toLowerCase().includes("row-level security")) {
    return {
      status: 403,
      message: "You do not have permission to create topics in this channel.",
    };
  }

  return {
    status: 500,
    message: message || "Unable to create topic.",
  };
}
