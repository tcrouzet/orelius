import type { OreliusSettings } from "./settings.ts";
import { t } from "./i18n.ts";

export function movedPath(path: string, from: string, to: string): string {
  return path === from || path.startsWith(from + "/") ? to + path.slice(from.length) : path;
}

export function moveProjects(settings: OreliusSettings, from: string, to: string, vault: string): OreliusSettings | null {
  const absolute = (path: string) => `${vault.replace(/\/$/, "")}/${path}`;
  const projects = [...new Set([settings.folder, ...Object.keys(settings.sessions)])]
    .filter(path => path && (path === from || path.startsWith(from + "/"))
      && (movedPath(path, from, to) !== path || Boolean(settings.sessions[path]?.cwd && settings.sessions[path].cwd !== absolute(path))));
  if (!projects.length) return null;
  const locations = projects.map(path => [settings.sessions[path]?.cwd || (path === settings.folder ? settings.threadCwd : "") || absolute(path), absolute(movedPath(path, from, to))]);
  const relocate = (path: string) => {
    const location = locations.slice().sort((a, b) => b[0].length - a[0].length).find(([old]) => path === old || path.startsWith(old + "/"));
    return location ? movedPath(path, location[0], location[1]) : path;
  };
  const remap = <T>(values: Record<string, T>, key: (path: string) => string): Record<string, T> => {
    const entries = Object.entries(values).map(([path, value]) => [key(path), value] as const);
    if (new Set(entries.map(([path]) => path)).size !== entries.length) throw new Error(t("projectMoveConflict"));
    return Object.fromEntries(entries);
  };
  const sessions = remap(settings.sessions, path => movedPath(path, from, to));
  for (const [path, value] of Object.entries(sessions)) sessions[path] = { ...value, cwd: relocate(value.cwd) };
  return { ...settings, folder: movedPath(settings.folder, from, to), threadCwd: relocate(settings.threadCwd), sessions,
    drafts: remap(settings.drafts, path => movedPath(path, from, to)),
    codexVersions: remap(settings.codexVersions, relocate),
    revisionHighlights: remap(settings.revisionHighlights, path => movedPath(path, from, to)),
    reactions: remap(settings.reactions, key => {
      let parts: unknown;
      try { parts = JSON.parse(key); } catch { return key; }
      if (!Array.isArray(parts) || parts.length !== 3 || !parts.every(part => typeof part === "string")) return key;
      return JSON.stringify([relocate(parts[0]), parts[1], parts[2]]);
    }),
  };
}

export function relocateVault(settings: OreliusSettings, vault: string): OreliusSettings | null {
  let relocated = settings;
  for (const folder of Object.keys(settings.sessions)) {
    if (folder) relocated = moveProjects(relocated, folder, folder, vault) ?? relocated;
  }
  return relocated === settings ? null : relocated;
}
