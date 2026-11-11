import { t } from "./i18n.ts";
import { object } from "./codex.ts";
import type { RevisionHighlight } from "./revision.ts";
import type { Reaction, ReactionRating } from "./reactions.ts";

interface FolderSession {
  threadId: string;
  cwd: string;
}

export interface ProjectFolders {
  archiveFolder: string;
  manuscriptFolder: string;
  modelFolder: string;
  bibleFolder: string;
}

export const PROJECT_FOLDER_KEYS = ["archiveFolder", "manuscriptFolder", "modelFolder", "bibleFolder"] as const;
export const DEFAULT_PROJECT_FOLDERS: ProjectFolders = {
  archiveFolder: "Archives", manuscriptFolder: "Manuscript", modelFolder: "Model", bibleFolder: "Bible",
};

export function validateFolderName(name: string): void {
  if (typeof name !== "string" || !name || name !== name.trim() || name.startsWith(".")
    || /[<>:"/\\|?*]/.test(name) || [...name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || name.endsWith(".")) {
    throw new Error(t("enterASimpleFolderNameWithoutAPathOr"));
  }
}

export function validateProjectFolders(folders: ProjectFolders): void {
  const names = PROJECT_FOLDER_KEYS.map(key => {
    validateFolderName(folders[key]);
    return folders[key].normalize("NFC").toLowerCase();
  });
  if (new Set(names).size !== names.length || names.slice(1).includes("_archives")
    || names.some(name => name === "agents.md" || name === "agents.override.md" || name === "context" || name === "tracking")) {
    throw new Error(t("foldersMustHaveDistinctNamesAgentsMdAgentsOverride"));
  }
}

export const WORKSHOP_FOLDERS = ["Seeds", "Synopsis", "Scenes", "Arcs", "Plots", "Variants", "Checks"];

export function isChapterPath(path: string, folders: Pick<ProjectFolders, "manuscriptFolder">): boolean {
  const prefix = `${folders.manuscriptFolder}/`.normalize("NFC").toLowerCase();
  const key = path.normalize("NFC").toLowerCase();
  if (!key.startsWith(prefix) || !key.endsWith(".md") || key.includes("\\")) return false;
  const parts = key.slice(prefix.length).split("/");
  const reserved = [...WORKSHOP_FOLDERS, "Chapters", "Characters", "Plan", "Summaries", "Context", "Tracking", "Brainstorm"].map(name => name.toLowerCase());
  return parts.every(part => part && !part.startsWith(".")) && !parts.slice(0, -1).some(part => reserved.includes(part));
}

export function projectPaths(folders: ProjectFolders): string[] {
  validateProjectFolders(folders);
  const content = [folders.manuscriptFolder, folders.modelFolder, folders.bibleFolder,
    ...[...WORKSHOP_FOLDERS, "Plan", "Summaries", "Characters", "Style", "World", "Brainstorm"].map(name => `${folders.bibleFolder}/${name}`),
    "Tracking"];
  return [folders.archiveFolder, ...content];
}

export interface OreliusSettings extends ProjectFolders {
  showActivity: boolean;
  debugMode: boolean;
  codexPath: string;
  folder: string;
  threadId: string;
  threadCwd: string;
  sessions: Record<string, FolderSession>;
  drafts: Record<string, string>;
  codexVersions: Record<string, Record<string, string>>;
  revisionHighlights: Record<string, RevisionHighlight>;
  reactions: Record<string, ReactionRating>;
}

export type SettingsChanges = Partial<Omit<OreliusSettings, "sessions">>;

export function associatedFolder(settings: OreliusSettings, path: string): string | undefined {
  return [...(settings.folder ? [settings.folder] : []), ...Object.keys(settings.sessions)]
    .filter(folder => folder !== "" && (path === folder || path.startsWith(`${folder}/`)))
    .sort((a, b) => b.length - a.length)[0];
}

export function modelProject(settings: OreliusSettings, path: string): string | undefined {
  return [...Object.keys(settings.sessions), ...(settings.folder ? [settings.folder] : [])]
    .find(folder => folder !== "" && path === `${folder}/${settings.modelFolder}`);
}

export function visibleFolder(settings: OreliusSettings, path: string | null, busy: boolean): string | undefined {
  if (path === null) return undefined;
  const folder = associatedFolder(settings, path);
  return busy && folder !== settings.folder ? undefined : folder;
}

function folderSession(settings: OreliusSettings): FolderSession | undefined {
  return Object.prototype.hasOwnProperty.call(settings.sessions, settings.folder)
    ? settings.sessions[settings.folder] : undefined;
}

export function loadSettings(value: unknown): OreliusSettings {
  const saved = object(value);
  const settings: OreliusSettings = {
    ...DEFAULT_PROJECT_FOLDERS, debugMode: saved.debugMode === true, showActivity: saved.showActivity === true,
    codexPath: "", folder: "", threadId: "", threadCwd: "", sessions: {}, drafts: {}, codexVersions: {}, revisionHighlights: {}, reactions: {},
  };
  for (const key of ["codexPath", "folder", "threadId", "threadCwd"] as const) {
    if (typeof saved[key] === "string") settings[key] = saved[key];
  }
  for (const key of PROJECT_FOLDER_KEYS) {
    if (saved[key] === undefined) continue;
    const name = saved[key];
    if (typeof name !== "string") throw new Error(t("invalidFolderNameFor", { value1: DEFAULT_PROJECT_FOLDERS[key] }));
    settings[key] = name;
  }
  if (saved.sessions !== undefined && (saved.sessions === null || typeof saved.sessions !== "object" || Array.isArray(saved.sessions))) {
    throw new Error(t("invalidAssociationsBetweenFoldersAndCodexSessions"));
  }
  settings.sessions = Object.fromEntries(Object.entries(object(saved.sessions)).map(([folder, value]) => {
    const session = object(value);
    if (typeof session.threadId !== "string" || typeof session.cwd !== "string") {
      throw new Error(t("invalidCodexAssociationForFolder", { value1: folder || t("vaultRoot") }));
    }
    return [folder, { threadId: session.threadId, cwd: session.cwd }];
  }));
  settings.drafts = Object.fromEntries(Object.entries(object(saved.drafts)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  if (saved.codexVersions !== undefined && (saved.codexVersions === null || typeof saved.codexVersions !== "object" || Array.isArray(saved.codexVersions))) {
    throw new Error(t("invalidCorrectionReferences"));
  }
  settings.codexVersions = Object.fromEntries(Object.entries(object(saved.codexVersions)).map(([cwd, versions]) => {
    if (versions === null || typeof versions !== "object" || Array.isArray(versions)) throw new Error(t("invalidCorrectionReferences"));
    return [cwd, Object.fromEntries(Object.entries(object(versions)).map(([path, text]): [string, string] => {
      if (typeof text !== "string") throw new Error(t("invalidCorrectionReferences"));
      return [path, text];
    }))];
  }));
  if (saved.revisionHighlights !== undefined && (saved.revisionHighlights === null || typeof saved.revisionHighlights !== "object" || Array.isArray(saved.revisionHighlights))) {
    throw new Error(t("invalidHighlightReferences"));
  }
  settings.revisionHighlights = Object.fromEntries(Object.entries(object(saved.revisionHighlights)).map(([path, value]) => {
    const snapshot = object(value);
    if (typeof snapshot.before !== "string" || typeof snapshot.after !== "string") throw new Error(t("invalidHighlightReferences"));
    return [path, { before: snapshot.before, after: snapshot.after }];
  }));
  if (saved.reactions !== undefined && (saved.reactions === null || typeof saved.reactions !== "object" || Array.isArray(saved.reactions))) {
    throw new Error(t("invalidSavedReactions"));
  }
  settings.reactions = Object.fromEntries(Object.entries(object(saved.reactions)).map(([key, value]) => {
    const reaction = object(value);
    if (typeof reaction.value !== "string" || !["heart", "up", "down"].includes(reaction.value) || typeof reaction.message !== "string" || typeof reaction.report !== "string") {
      throw new Error(t("aSavedReactionIsInvalid"));
    }
    return [key, { value: reaction.value as Reaction, message: reaction.message, report: reaction.report }];
  }));
  if (settings.threadId && !folderSession(settings)) {
    settings.sessions = { ...settings.sessions,
      [settings.folder]: { threadId: settings.threadId, cwd: settings.threadCwd } };
  }
  return applySettings(settings, {});
}

export function applySettings(previous: OreliusSettings, changes: SettingsChanges): OreliusSettings {
  const next = { ...previous, ...changes };
  validateProjectFolders(next);
  if (changes.threadId !== undefined || changes.threadCwd !== undefined) {
    next.sessions = { ...previous.sessions,
      [next.folder]: { threadId: next.threadId, cwd: next.threadCwd } };
  }
  const session = folderSession(next);
  return { ...next, threadId: session?.threadId ?? "", threadCwd: session?.cwd ?? "" };
}
