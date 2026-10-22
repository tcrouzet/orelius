import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { object } from "./codex.ts";
import { DEFAULT_PROJECT_FOLDERS, projectPaths, validateFolderName, type ProjectFolders } from "./settings.ts";

async function checkPath(root: string, path: string): Promise<void> {
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (object(error).code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error("Les liens symboliques ne peuvent pas être modifiés ni servir d’archives.");
  }
}

export async function prepareProject(cwd: string, folders: ProjectFolders): Promise<void> {
  const paths = projectPaths(folders);
  const root = await realpath(cwd);
  for (const path of paths) {
    const target = join(root, path);
    await checkPath(root, target);
    try { await mkdir(target); }
    catch (error) { if (object(error).code !== "EEXIST") throw error; }
    if (!(await lstat(target)).isDirectory()) throw new Error(`Un fichier occupe le chemin du dossier ${path}.`);
    await checkPath(root, target);
  }
}

export async function archiveChanges(cwd: string, changes: unknown,
  checkEditor: (path: string, content: string) => void = () => {},
  archiveFolder: string = DEFAULT_PROJECT_FOLDERS.archiveFolder): Promise<string[]> {
  validateFolderName(archiveFolder);
  if (!Array.isArray(changes) || !changes.length) throw new Error("Liste des modifications absente. Écriture refusée.");
  const root = await realpath(cwd);
  const suppliedRoot = resolve(cwd);
  const targets = changes.map(value => {
    const change = object(value);
    const kind = object(change.kind);
    if (typeof change.path !== "string" || !change.path || change.path.includes("\0")
      || !["add", "update"].includes(String(kind.type)) || kind.move_path != null) {
      throw new Error("Seules la création et la modification de fichiers sont prises en charge.");
    }
    const requested = resolve(suppliedRoot, change.path);
    // macOS can expose the same project through /var and /private/var.
    const target = requested.startsWith(`${suppliedRoot}${sep}`)
      ? resolve(root, relative(suppliedRoot, requested)) : requested;
    const path = relative(root, target);
    if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)
      || [archiveFolder.normalize("NFC").toLowerCase(), "_archives", ".obsidian", ".git"]
        .includes(path.split(sep)[0].normalize("NFC").toLowerCase())) {
      throw new Error(`Écriture refusée : le fichier doit appartenir au projet, hors ${archiveFolder}, _Archives et dossiers internes.`);
    }
    return { target, path, creating: kind.type === "add" };
  });
  for (const { target } of targets) await checkPath(root, target);
  const archives: string[] = [];
  for (const { target, path, creating } of targets) {
    let source;
    try { source = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      if (creating && object(error).code === "ENOENT") continue;
      throw error;
    }
    try {
      const before = await source.stat();
      if (!before.isFile() || before.nlink !== 1) throw new Error(`Fichier ordinaire sans lien requis : ${path}`);
      const original = await source.readFile();
      checkEditor(path.split(sep).join("/"), original.toString("utf8"));
      const directory = join(root, archiveFolder, dirname(path));
      await checkPath(root, directory);
      await mkdir(directory, { recursive: true });
      await checkPath(root, directory);
      const extension = extname(path);
      const version = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
      const archive = join(directory, `${basename(path, extension)}.${version}${extension}`);
      const copy = await open(archive, "wx", before.mode & 0o777);
      try { await copy.writeFile(original); await copy.sync(); }
      finally { await copy.close(); }
      const after = await lstat(target);
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
        || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new Error(`Le fichier a changé pendant l’archivage : ${path}. Relancez la demande.`);
      }
      checkEditor(path.split(sep).join("/"), original.toString("utf8"));
      archives.push(relative(root, archive).split(sep).join("/"));
    } finally { await source.close(); }
  }
  return archives;
}
