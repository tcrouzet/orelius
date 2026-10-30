import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { checkPath } from "./archives.ts";
import { fingerprint } from "./narrative-context.ts";
import { readProjectFile } from "./project-files.ts";
import type { ProjectFolders } from "./settings.ts";

export interface ProjectSource { path: string; content: string; hash: string }

export async function projectSources(cwd: string, folders: ProjectFolders, only?: string[]): Promise<ProjectSource[]> {
  const root = await realpath(cwd);
  const sources: ProjectSource[] = [];
  async function walk(directory: string): Promise<void> {
    await checkPath(root, join(root, directory));
    let entries;
    try { entries = await readdir(join(root, directory), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      if (path.startsWith(`${folders.bibleFolder}/Suivi/`) && entry.name !== "Connaissances.md") continue;
      if (path === `${folders.bibleFolder}/suivi.md`) continue;
      if (directory === `${folders.manuscriptFolder}/Context` && entry.name !== "configuration.md" && entry.name !== "Prompts") continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const file = await readProjectFile(cwd, path);
        if (file) sources.push({ path, content: file.text, hash: fingerprint(file.text) });
      }
    }
  }
  for (const path of only ?? [folders.manuscriptFolder, folders.modelFolder, folders.bibleFolder]) await walk(path);
  return sources.sort((a, b) => a.path.localeCompare(b.path, "fr", { numeric: true }));
}

