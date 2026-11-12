import { t } from "./i18n.ts";
import type { ProjectFolders } from "./settings.ts";

const PREFIX = "[Orelius : brainstorm]\n";
export const BRAINSTORM_INPUT = "[Brainstorm]\n\n";
export interface BrainstormRequest { folder: string; document?: string }

export function brainstormFolder(path: string | null | undefined, folders: ProjectFolders): string | null {
  if (!path || path.includes("\\") || path.includes("\0") || path.split("/").some(part => !part || part.startsWith("."))) return null;
  const key = path.normalize("NFC").toLowerCase();
  return ["Brainstorm", `${folders.bibleFolder}/Brainstorm`, `${folders.manuscriptFolder}/Brainstorm`]
    .find(folder => key === folder.normalize("NFC").toLowerCase() || key.startsWith(folder.normalize("NFC").toLowerCase() + "/")) ?? null;
}

export function brainstormRequest(text: string): BrainstormRequest | null {
  if (!text.startsWith(PREFIX)) return null;
  const end = text.indexOf("\n\n", PREFIX.length);
  let value: unknown;
  try { value = JSON.parse(text.slice(PREFIX.length, end)); } catch { throw new Error(t("brainstormInvalid")); }
  if (end < 0 || !value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("brainstormInvalid"));
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some(key => !["folder", "document"].includes(key)) || typeof request.folder !== "string"
    || request.document !== undefined && typeof request.document !== "string") throw new Error(t("brainstormInvalid"));
  return { folder: request.folder, ...(typeof request.document === "string" ? { document: request.document } : {}) };
}

export function withoutBrainstorm(text: string): string {
  return brainstormRequest(text) ? text.slice(text.indexOf("\n\n", PREFIX.length) + 2) : text;
}

export function withBrainstorm(text: string, request: BrainstormRequest): string {
  return PREFIX + JSON.stringify(request) + "\n\n" + withoutBrainstorm(text);
}

export function checkBrainstormWrite(request: BrainstormRequest, path: string, folders: ProjectFolders): void {
  if (brainstormFolder(request.folder, folders) !== request.folder || brainstormFolder(path, folders) !== request.folder
    || !/\.(md|csv)$/i.test(path) || !/\.csv$/i.test(path) && request.document && path.normalize("NFC").toLowerCase() !== request.document.normalize("NFC").toLowerCase()) {
    throw new Error(t("brainstormWriteOnly"));
  }
}
