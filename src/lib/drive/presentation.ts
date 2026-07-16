import type { LucideIcon } from "lucide-react";
import {
  Camera,
  Download,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  Mail,
  Presentation,
} from "lucide-react";
import { fileExtensionLabel } from "./format";

export type DriveItemKind =
  | "folder"
  | "spreadsheet"
  | "document"
  | "pdf"
  | "presentation"
  | "image"
  | "markdown"
  | "email"
  | "report"
  | "evidence"
  | "archive"
  | "other";

export type DrivePresentation = {
  kind: DriveItemKind;
  extension: string;
  typeLabel: string;
  categoryLabel: string;
  icon: LucideIcon;
  iconClass: string;
  displayTitle: string;
};

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "application/csv": "csv",
  "text/markdown": "md",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function extensionFromPath(pathOrName: string): string | null {
  const base = pathOrName.split("/").pop() ?? pathOrName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

function resolveExtension(input: {
  extension?: string;
  mimeType?: string;
  storagePath?: string;
  title?: string;
}): string {
  const fromField = input.extension?.toLowerCase();
  if (fromField) return fromField;

  const fromPath = input.storagePath ? extensionFromPath(input.storagePath) : null;
  if (fromPath) return fromPath;

  const fromTitle = input.title ? extensionFromPath(input.title) : null;
  if (fromTitle) return fromTitle;

  if (input.mimeType) {
    const fromMime = MIME_TO_EXT[input.mimeType.toLowerCase()];
    if (fromMime) return fromMime;
  }

  return "file";
}

function kindFromExtension(ext: string): DriveItemKind {
  if (["xlsx", "xls", "csv"].includes(ext)) return "spreadsheet";
  if (["doc", "docx", "txt"].includes(ext)) return "document";
  if (ext === "pdf") return "pdf";
  if (["ppt", "pptx"].includes(ext)) return "presentation";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (ext === "md") return "markdown";
  if (["zip", "gz", "tar"].includes(ext)) return "archive";
  return "other";
}

function iconForKind(kind: DriveItemKind): { icon: LucideIcon; iconClass: string } {
  switch (kind) {
    case "folder":
      return { icon: Folder, iconClass: "text-amber-700 bg-amber-50" };
    case "spreadsheet":
      return { icon: FileSpreadsheet, iconClass: "text-emerald-700 bg-emerald-50" };
    case "document":
      return { icon: FileText, iconClass: "text-sky-700 bg-sky-50" };
    case "pdf":
      return { icon: FileText, iconClass: "text-rose-700 bg-rose-50" };
    case "presentation":
      return { icon: Presentation, iconClass: "text-orange-700 bg-orange-50" };
    case "image":
      return { icon: FileImage, iconClass: "text-fuchsia-700 bg-fuchsia-50" };
    case "markdown":
      return { icon: FileText, iconClass: "text-violet-700 bg-violet-50" };
    case "email":
      return { icon: Mail, iconClass: "text-indigo-700 bg-indigo-50" };
    case "report":
      return { icon: FileText, iconClass: "text-violet-700 bg-violet-50" };
    case "evidence":
      return { icon: Camera, iconClass: "text-emerald-700 bg-emerald-50" };
    case "archive":
      return { icon: FileArchive, iconClass: "text-stone-700 bg-stone-100" };
    default:
      return { icon: Download, iconClass: "text-slate-700 bg-slate-100" };
  }
}

export function cleanDriveTitle(title: string): string {
  return title.replace(/\s*\(export\)\s*$/i, "").trim();
}

export function driveFilePresentation(input: {
  itemType: "file" | "export" | "artifact" | "evidence";
  title: string;
  mimeType?: string;
  extension?: string;
  storagePath?: string;
  exportType?: string;
  artifactType?: string;
  contentKind?: string;
}): DrivePresentation {
  const displayTitle = cleanDriveTitle(input.title);
  const extension = resolveExtension({
    extension: input.extension,
    mimeType: input.mimeType,
    storagePath: input.storagePath,
    title: input.title,
  });

  let kind: DriveItemKind = kindFromExtension(extension);
  let categoryLabel = "File";

  if (input.itemType === "export") {
    categoryLabel =
      kind === "spreadsheet"
        ? "Spreadsheet"
        : kind === "pdf"
          ? "PDF"
          : kind === "document"
            ? "Word"
            : kind === "presentation"
              ? "PowerPoint"
              : "Download";
  } else if (input.itemType === "artifact") {
    if (input.contentKind === "spreadsheet" || input.artifactType === "spreadsheet") {
      kind = "spreadsheet";
    } else if (input.artifactType === "email_draft") {
      kind = "email";
    } else if (
      input.artifactType === "research_summary" ||
      input.artifactType === "strategy_memo" ||
      input.exportType === "report"
    ) {
      kind = "report";
    } else if (
      /\.md$/i.test(displayTitle) ||
      /AI source/i.test(displayTitle) ||
      extension === "md"
    ) {
      kind = "markdown";
    }
    categoryLabel =
      input.artifactType === "email_draft"
        ? "Email draft"
        : kind === "markdown" || /\.md$/i.test(displayTitle) || /AI source/i.test(displayTitle)
          ? "AI note"
          : "Artifact";
  } else if (input.itemType === "evidence") {
    kind = input.mimeType?.startsWith("image/") ? "image" : "evidence";
    categoryLabel = "Evidence";
  } else {
    categoryLabel = "File";
  }

  const { icon, iconClass } = iconForKind(kind);
  const typeLabel =
    kind === "spreadsheet"
      ? extension.toUpperCase()
      : fileExtensionLabel(displayTitle.includes(".") ? displayTitle : `${displayTitle}.${extension}`);

  return {
    kind,
    extension,
    typeLabel,
    categoryLabel,
    icon,
    iconClass,
    displayTitle,
  };
}

export function driveFolderPresentation(name: string): DrivePresentation {
  const { icon, iconClass } = iconForKind("folder");
  return {
    kind: "folder",
    extension: "",
    typeLabel: "FOLDER",
    categoryLabel: "Folder",
    icon,
    iconClass,
    displayTitle: name,
  };
}
