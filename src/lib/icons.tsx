import {
  Activity,
  Boxes,
  Brain,
  Briefcase,
  Calendar,
  ClipboardList,
  Code2,
  CreditCard,
  Database,
  FileText,
  Figma,
  Folder,
  Gamepad2,
  Github,
  Globe,
  HardDrive,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Microscope,
  Palette,
  Rocket,
  Search,
  Send,
  Server,
  Settings2,
  Sparkles,
  TerminalSquare,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  ApprovalRisk,
  EmployeeRoleKey,
  EmployeeStatus,
  TaskStatus,
  ToolStatus,
} from "./types";

export const TOOL_ICONS: Record<string, LucideIcon> = {
  "web-search": Search,
  browser: Globe,
  perplexity: Sparkles,
  files: FileText,
  "google-drive": HardDrive,
  github: Github,
  cursor: TerminalSquare,
  vercel: Rocket,
  supabase: Database,
  figma: Figma,
  notion: FileText,
  linear: ClipboardList,
  slack: MessageSquare,
  discord: MessageSquare,
  gmail: Mail,
  calendar: Calendar,
  unity: Boxes,
  godot: Gamepad2,
  blender: Boxes,
  stripe: CreditCard,
  openai: Brain,
  anthropic: Brain,
  gemini: Brain,
};

export function toolIcon(id: string): LucideIcon {
  return TOOL_ICONS[id] ?? Wrench;
}

export const ROLE_ICONS: Record<EmployeeRoleKey, LucideIcon> = {
  research: Microscope,
  pm: ClipboardList,
  engineering: Code2,
  design: Palette,
  marketing: Rocket,
  gamedev: Gamepad2,
  operations: Settings2,
  sales: Briefcase,
  support: MessageSquare,
};

export function roleIcon(key: EmployeeRoleKey): LucideIcon {
  return ROLE_ICONS[key] ?? Sparkles;
}

// Status presentation -------------------------------------------------------

export const STATUS_META: Record<
  EmployeeStatus,
  { label: string; dot: string; text: string; ring: string }
> = {
  idle: { label: "Idle", dot: "bg-slate-400", text: "text-slate-600", ring: "ring-slate-400/20" },
  working: { label: "Working", dot: "bg-emerald-400", text: "text-emerald-700", ring: "ring-emerald-400/20" },
  waiting_approval: { label: "Waiting for approval", dot: "bg-amber-400", text: "text-amber-700", ring: "ring-amber-400/20" },
  on_call: { label: "On call", dot: "bg-sky-400", text: "text-sky-700", ring: "ring-sky-400/20" },
  blocked: { label: "Blocked", dot: "bg-rose-400", text: "text-rose-600", ring: "ring-rose-400/20" },
};

export const TASK_STATUS_META: Record<
  TaskStatus,
  { label: string; color: string; bg: string }
> = {
  open: { label: "Open", color: "text-slate-600", bg: "bg-slate-500/15" },
  in_progress: { label: "In progress", color: "text-sky-700", bg: "bg-sky-50" },
  waiting_approval: { label: "Waiting for approval", color: "text-amber-700", bg: "bg-amber-500/15" },
  blocked: { label: "Blocked", color: "text-rose-600", bg: "bg-rose-500/15" },
  done: { label: "Done", color: "text-emerald-700", bg: "bg-emerald-500/15" },
};

export const RISK_META: Record<
  ApprovalRisk,
  { label: string; color: string; bg: string; border: string }
> = {
  low: { label: "Low risk", color: "text-emerald-700", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  medium: { label: "Medium risk", color: "text-amber-700", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  high: { label: "High risk", color: "text-rose-600", bg: "bg-rose-500/10", border: "border-rose-500/30" },
};

export const TOOL_STATUS_META: Record<
  ToolStatus,
  { label: string; color: string; dot: string }
> = {
  connected: { label: "Connected", color: "text-emerald-700", dot: "bg-emerald-400" },
  mock: { label: "Mock mode", color: "text-sky-700", dot: "bg-sky-400" },
  not_connected: { label: "Not connected", color: "text-slate-400", dot: "bg-slate-500" },
};

export {
  Activity,
  Brain,
  Folder,
  LayoutDashboard,
  Send,
  Server,
  Sparkles,
  Wrench,
};
