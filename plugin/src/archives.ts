import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { object } from "./codex.ts";
import { DEFAULT_PROJECT_FOLDERS, projectPaths, validateFolderName, type ProjectFolders } from "./settings.ts";

export async function checkPath(root: string, path: string, configDir?: string): Promise<void> {
  const location = relative(root, path);
  if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) throw new Error("Le fichier doit rester dans le projet.");
  if (configDir) {
    const requested = resolve(root, configDir);
    let ancestor = requested;
    let configuration: string;
    while (true) {
      try { configuration = resolve(await realpath(ancestor), relative(ancestor, requested)); break; }
      catch (error) {
        if (object(error).code !== "ENOENT" || dirname(ancestor) === ancestor) throw error;
        ancestor = dirname(ancestor);
      }
    }
    const configured = relative(configuration.normalize("NFC").toLowerCase(), path.normalize("NFC").toLowerCase());
    if (!configured || configured !== ".." && !configured.startsWith(`..${sep}`) && !isAbsolute(configured)) {
      throw new Error("Écriture refusée dans le dossier de configuration Obsidian.");
    }
  }
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

export async function prepareProject(cwd: string, folders: ProjectFolders, configDir?: string): Promise<void> {
  const paths = projectPaths(folders);
  const root = await realpath(cwd);
  for (const path of paths) {
    const target = join(root, path);
    await checkPath(root, target, configDir);
    try { await mkdir(target); }
    catch (error) { if (object(error).code !== "EEXIST") throw error; }
    if (!(await lstat(target)).isDirectory()) throw new Error(`Un fichier occupe le chemin du dossier ${path}.`);
    await checkPath(root, target);
  }
}

function archiveTarget(root: string, suppliedRoot: string, requestedPath: string, archiveFolder: string): { target: string; path: string } {
  if (typeof requestedPath !== "string" || !requestedPath || requestedPath.includes("\0")) throw new Error("Chemin de fichier invalide.");
  const requested = resolve(suppliedRoot, requestedPath);
  // macOS can expose the same project through /var and /private/var.
  const target = requested.startsWith(`${suppliedRoot}${sep}`) ? resolve(root, relative(suppliedRoot, requested)) : requested;
  const path = relative(root, target);
  if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)
    || [archiveFolder.normalize("NFC").toLowerCase(), "_archives", ".git"]
      .includes(path.split(sep)[0].normalize("NFC").toLowerCase())) {
    throw new Error(`Écriture refusée : le fichier doit appartenir au projet, hors ${archiveFolder}, _Archives et dossiers internes.`);
  }
  return { target, path };
}

async function writeArchive(root: string, path: string, content: Uint8Array, mode: number,
  archiveFolder: string, suffix: "" | "-h", configDir?: string): Promise<string> {
  const directory = join(root, archiveFolder, path.toLowerCase() === "agents.md" ? "Agents" : dirname(path));
  await checkPath(root, directory, configDir);
  await mkdir(directory, { recursive: true });
  await checkPath(root, directory);
  const extension = extname(path);
  const version = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const archive = join(directory, `${basename(path, extension)}.${version}${suffix}${extension}`);
  const copy = await open(archive, "wx", mode & 0o777);
  try { await copy.writeFile(content); await copy.sync(); }
  finally { await copy.close(); }
  return relative(root, archive).split(sep).join("/");
}

export async function archiveGenerated(cwd: string, path: string, content: string, archiveFolder: string, mode = 0o600, configDir?: string): Promise<string> {
  validateFolderName(archiveFolder);
  const root = await realpath(cwd);
  const location = archiveTarget(root, resolve(cwd), path, archiveFolder);
  await checkPath(root, location.target, configDir);
  return writeArchive(root, location.path, Buffer.from(content, "utf8"), mode, archiveFolder, "", configDir);
}

export async function archiveChanges(cwd: string, changes: unknown,
  checkEditor: (path: string, content: string) => void = () => {},
  archiveFolder: string = DEFAULT_PROJECT_FOLDERS.archiveFolder, suffix: "" | "-h" = "", configDir?: string): Promise<string[]> {
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
    return { ...archiveTarget(root, suppliedRoot, change.path, archiveFolder), creating: kind.type === "add" };
  });
  for (const { target } of targets) await checkPath(root, target, configDir);
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
      const archive = await writeArchive(root, path, original, before.mode, archiveFolder, suffix, configDir);
      const after = await lstat(target);
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
        || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new Error(`Le fichier a changé pendant l’archivage : ${path}. Relancez la demande.`);
      }
      checkEditor(path.split(sep).join("/"), original.toString("utf8"));
      archives.push(archive);
    } finally { await source.close(); }
  }
  return archives;
}
