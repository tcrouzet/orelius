import { t } from "./i18n.ts";
import { lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { checkPath } from "./archives.ts";
import { object } from "./codex.ts";
import { projectPaths, type ProjectFolders } from "./settings.ts";

export async function resetProject(cwd: string, folders: ProjectFolders, configDir?: string,
  vault?: { mkdir: (path: string) => Promise<void>; remove: (path: string) => Promise<void> }): Promise<void> {
  const paths = projectPaths(folders);
  const root = await realpath(cwd);
  const names = [...new Set([folders.archiveFolder, folders.bibleFolder, folders.manuscriptFolder, "Tracking", "_Archives",
    ...(await readdir(root)).filter(name => name.toLowerCase() === "context")])];
  const present: string[] = [];
  for (const name of names) {
    const path = join(root, name);
    await checkPath(root, path, configDir);
    if (configDir && resolve(root, configDir).normalize("NFC").toLowerCase().startsWith(`${path.normalize("NFC").toLowerCase()}${sep}`)) {
      throw new Error(t("writingToTheObsidianConfigurationFolderIsNotAllowed"));
    }
    try {
      const stat = await lstat(path);
      if (!stat.isDirectory()) throw new Error(t("resetNotDirectory", { name }));
      present.push(name);
    } catch (error) { if (object(error).code !== "ENOENT") throw error; }
  }
  const create = vault?.mkdir ?? (async (path: string) => { await mkdir(join(root, path), { recursive: true }); });
  const remove = vault?.remove ?? (async (path: string) => { await rm(join(root, path), { recursive: true, force: true }); });
  for (const name of present) await remove(name);
  for (const path of paths.filter(path => names.some(name => path === name || path.startsWith(`${name}/`)))) {
    await create(path);
  }
}
