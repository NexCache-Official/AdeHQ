/** In-process registry for active live browser research sessions (cancel + cleanup). */

export type BrowserResearchLiveSession = {
  runId: string;
  abortController: AbortController;
  close: () => Promise<void>;
};

const activeSessions = new Map<string, BrowserResearchLiveSession>();

export function registerBrowserResearchLiveSession(session: BrowserResearchLiveSession): void {
  activeSessions.set(session.runId, session);
}

export function unregisterBrowserResearchLiveSession(runId: string): void {
  activeSessions.delete(runId);
}

export function getBrowserResearchLiveSession(runId: string): BrowserResearchLiveSession | undefined {
  return activeSessions.get(runId);
}

export function isBrowserResearchRunAbortRequested(runId: string): boolean {
  return activeSessions.get(runId)?.abortController.signal.aborted ?? false;
}

/** Terminate a live session — abort in-flight work and close Browserbase. Safe to call multiple times. */
export async function terminateBrowserResearchLiveSession(runId: string): Promise<void> {
  const session = activeSessions.get(runId);
  if (!session) return;
  session.abortController.abort();
  try {
    await session.close();
  } catch (error) {
    console.warn("[AdeHQ browser research] session close error", error);
  } finally {
    activeSessions.delete(runId);
  }
}
