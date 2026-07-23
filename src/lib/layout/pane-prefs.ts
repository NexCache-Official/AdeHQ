export type PanePrefs = {
  width: number;
  collapsed: boolean;
};

export type PaneLimits = {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  collapsedWidth?: number;
};

const PREFIX = "adehq.pane.";

export function paneStorageKey(id: string): string {
  return `${PREFIX}${id}`;
}

export function readPanePrefs(id: string, limits: PaneLimits): PanePrefs {
  const fallback: PanePrefs = {
    width: clamp(limits.defaultWidth, limits.minWidth, limits.maxWidth),
    collapsed: false,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(paneStorageKey(id));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PanePrefs>;
    return {
      width: clamp(
        typeof parsed.width === "number" ? parsed.width : fallback.width,
        limits.minWidth,
        limits.maxWidth,
      ),
      collapsed: Boolean(parsed.collapsed),
    };
  } catch {
    return fallback;
  }
}

export function writePanePrefs(id: string, prefs: PanePrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(paneStorageKey(id), JSON.stringify(prefs));
  } catch {
    // ignore quota / private mode
  }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Shared pane defaults used across the app shell. */
export const PANE_PRESETS = {
  appRail: {
    id: "app-rail",
    defaultWidth: 260,
    minWidth: 220,
    maxWidth: 340,
    collapsedWidth: 52,
  },
  roomTopics: {
    id: "room-topics",
    defaultWidth: 266,
    minWidth: 200,
    maxWidth: 420,
    collapsedWidth: 44,
  },
  roomContext: {
    id: "room-context",
    defaultWidth: 344,
    minWidth: 280,
    maxWidth: 520,
    collapsedWidth: 44,
  },
  inboxFolders: {
    id: "inbox-folders",
    defaultWidth: 208,
    minWidth: 180,
    maxWidth: 300,
    collapsedWidth: 44,
  },
  inboxList: {
    id: "inbox-list",
    defaultWidth: 320,
    minWidth: 240,
    maxWidth: 480,
    collapsedWidth: 44,
  },
  driveNav: {
    id: "drive-nav",
    defaultWidth: 224,
    minWidth: 180,
    maxWidth: 320,
    collapsedWidth: 44,
  },
} as const;
