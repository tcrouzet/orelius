import { object } from "./codex.ts";

interface FolderSession {
  threadId: string;
  cwd: string;
}

export interface ProjectFolders {
  archiveFolder: string;
  manuscriptFolder: string;
  bibleFolder: string;
}

export const PROJECT_FOLDER_KEYS = ["archiveFolder", "manuscriptFolder", "bibleFolder"] as const;
export const DEFAULT_PROJECT_FOLDERS: ProjectFolders = {
  archiveFolder: "Archives", manuscriptFolder: "Manuscript", bibleFolder: "Bible",
};

export function validateFolderName(name: string): void {
  if (typeof name !== "string" || !name || name !== name.trim() || name.startsWith(".")
    || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name) || name.endsWith(".")) {
    throw new Error("Indiquez un nom de dossier simple, sans chemin ni caractère réservé.");
  }
}

export function validateProjectFolders(folders: ProjectFolders): void {
  const names = PROJECT_FOLDER_KEYS.map(key => {
    validateFolderName(folders[key]);
    return folders[key].normalize("NFC").toLowerCase();
  });
  if (new Set(names).size !== names.length || names.slice(1).includes("_archives")
    || names.some(name => name === "agents.md" || name === "agents.override.md")) {
    throw new Error("Les dossiers doivent avoir des noms distincts ; AGENTS.md, AGENTS.override.md et les anciennes archives _Archives sont réservés.");
  }
}

export function projectPaths(folders: ProjectFolders): string[] {
  validateProjectFolders(folders);
  const content = [folders.manuscriptFolder,
    ...["Chapitres", "Personnages", "Plan", "Resume"].map(name => `${folders.manuscriptFolder}/${name}`),
    folders.bibleFolder];
  return [folders.archiveFolder, ...content, ...content.map(path => `${folders.archiveFolder}/${path}`)];
}

export interface OreliusSettings extends ProjectFolders {
  codexPath: string;
  folder: string;
  threadId: string;
  threadCwd: string;
  sessions: Record<string, FolderSession>;
}

export type SettingsChanges = Partial<Omit<OreliusSettings, "sessions">>;

export function associatedFolder(settings: OreliusSettings, path: string): string | undefined {
  return [settings.folder, ...Object.keys(settings.sessions)]
    .filter(folder => folder === "" || path === folder || path.startsWith(`${folder}/`))
    .sort((a, b) => b.length - a.length)[0];
}

export function visibleFolder(settings: OreliusSettings, path: string, busy: boolean): string | undefined {
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
    ...DEFAULT_PROJECT_FOLDERS, codexPath: "", folder: "", threadId: "", threadCwd: "", sessions: {},
  };
  for (const key of ["codexPath", "folder", "threadId", "threadCwd"] as const) {
    if (typeof saved[key] === "string") settings[key] = saved[key];
  }
  for (const key of PROJECT_FOLDER_KEYS) {
    if (saved[key] === undefined) continue;
    if (typeof saved[key] !== "string") throw new Error(`Nom de dossier invalide pour ${DEFAULT_PROJECT_FOLDERS[key]}.`);
    settings[key] = saved[key];
  }
  if (saved.sessions !== undefined && (saved.sessions === null || typeof saved.sessions !== "object" || Array.isArray(saved.sessions))) {
    throw new Error("Les associations entre dossiers et sessions Codex sont invalides.");
  }
  settings.sessions = Object.fromEntries(Object.entries(object(saved.sessions)).map(([folder, value]) => {
    const session = object(value);
    if (typeof session.threadId !== "string" || typeof session.cwd !== "string") {
      throw new Error(`Association Codex invalide pour le dossier « ${folder || "Racine du coffre"} ».`);
    }
    return [folder, { threadId: session.threadId, cwd: session.cwd }];
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
