import { t } from "./i18n.ts";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename } from "node:fs/promises";
import { join } from "node:path";
import { checkPath } from "./archives.ts";
import { object } from "./codex.ts";
import { projectPaths, type ProjectFolders } from "./settings.ts";

export async function resetProject(cwd: string, folders: ProjectFolders, configDir?: string): Promise<string> {
  const paths = projectPaths(folders);
  const root = await realpath(cwd);
  const names = [folders.bibleFolder, folders.manuscriptFolder];
  const backup = `${folders.archiveFolder}/Reset-${new Date().toISOString().replace(/:/g, "-")}-${randomUUID()}`;
  await checkPath(root, join(root, backup), configDir);
  const present: string[] = [];
  for (const name of names) {
    const path = join(root, name);
    await checkPath(root, path, configDir);
    try {
      const stat = await lstat(path);
      if (!stat.isDirectory()) throw new Error(t("resetNotDirectory", { name }));
      present.push(name);
    } catch (error) { if (object(error).code !== "ENOENT") throw error; }
  }
  await mkdir(join(root, backup), { recursive: true });
  for (const name of present) await rename(join(root, name), join(root, backup, name));
  for (const path of paths.filter(path => names.some(name => path === name || path.startsWith(`${name}/`)))) {
    await mkdir(join(root, path), { recursive: true });
  }
  return backup;
}
